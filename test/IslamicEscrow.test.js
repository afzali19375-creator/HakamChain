const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('IslamicEscrow', function () {
  const DEPOSIT = ethers.parseEther('0.01');
  const CAP = ethers.parseEther('0.05');

  async function deployFixture() {
    const [admin, employer, contractor, stranger] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory('IslamicEscrow');
    const escrow = await Factory.deploy();
    await escrow.waitForDeployment();
    return { escrow, admin, employer, contractor, stranger };
  }

  async function fundedFixture() {
    const f = await deployFixture();
    await f.escrow.connect(f.employer).createEscrow(f.contractor.address, { value: DEPOSIT });
    return f;
  }

  it('lets the employer fund an escrow and stores case data', async function () {
    const { escrow, employer, contractor } = await deployFixture();

    await escrow.connect(employer).createEscrow(contractor.address, { value: DEPOSIT });

    const e = await escrow.getEscrow(1);
    expect(e.employer).to.equal(employer.address);
    expect(e.contractor).to.equal(contractor.address);
    expect(e.amount).to.equal(DEPOSIT);
    expect(e.status).to.equal(0n); // Funded
    expect(await escrow.nextEscrowId()).to.equal(2n);
  });

  it('enforces the 0.05 ETH safe-margin cap', async function () {
    const { escrow, employer, contractor } = await deployFixture();

    await expect(
      escrow.connect(employer).createEscrow(contractor.address, { value: CAP + 1n })
    ).to.be.revertedWithCustomError(escrow, 'DepositTooHigh');

    // exactly the cap is allowed
    await escrow.connect(employer).createEscrow(contractor.address, { value: CAP });
    expect((await escrow.getEscrow(1)).amount).to.equal(CAP);
  });

  it('rejects zero deposits and invalid contractors', async function () {
    const { escrow, employer } = await deployFixture();

    await expect(
      escrow.connect(employer).createEscrow(employer.address, { value: 0 })
    ).to.be.revertedWithCustomError(escrow, 'ZeroDeposit');

    await expect(
      escrow.connect(employer).createEscrow(employer.address, { value: DEPOSIT })
    ).to.be.revertedWithCustomError(escrow, 'InvalidParty');

    await expect(
      escrow.connect(employer).createEscrow(ethers.ZeroAddress, { value: DEPOSIT })
    ).to.be.revertedWithCustomError(escrow, 'InvalidParty');
  });

  it('only the platform admin (owner) can release funds', async function () {
    const { escrow, employer, contractor } = await fundedFixture();

    await expect(
      escrow.connect(employer).releaseFunds(1, false)
    ).to.be.revertedWithCustomError(escrow, 'OwnableUnauthorizedAccount');

    await expect(
      escrow.connect(contractor).releaseFunds(1, true)
    ).to.be.revertedWithCustomError(escrow, 'OwnableUnauthorizedAccount');
  });

  it('releases funds to the contractor when the council rules for them', async function () {
    const { escrow, admin, contractor } = await fundedFixture();
    const before = await ethers.provider.getBalance(contractor.address);

    await escrow.connect(admin).releaseFunds(1, false);

    const e = await escrow.getEscrow(1);
    expect(e.status).to.equal(2n); // ReleasedToContractor
    expect(e.amount).to.equal(0n);
    expect(await ethers.provider.getBalance(contractor.address) - before).to.equal(DEPOSIT);
  });

  it('refunds the employer when the council rules for them', async function () {
    const { escrow, admin, employer } = await fundedFixture();
    const before = await ethers.provider.getBalance(employer.address);

    await escrow.connect(admin).releaseFunds(1, true);

    const e = await escrow.getEscrow(1);
    expect(e.status).to.equal(3n); // RefundedToEmployer
    expect(e.amount).to.equal(0n);
    expect(await ethers.provider.getBalance(employer.address) - before).to.equal(DEPOSIT);
  });

  it('prevents double release of the same escrow', async function () {
    const { escrow, admin } = await fundedFixture();

    await escrow.connect(admin).releaseFunds(1, false);

    await expect(
      escrow.connect(admin).releaseFunds(1, true)
    ).to.be.revertedWithCustomError(escrow, 'NothingToRelease');
  });

  it('lets a party declare a dispute and blocks strangers', async function () {
    const { escrow, employer, contractor, stranger } = await fundedFixture();

    await expect(escrow.connect(stranger).declareDispute(1))
      .to.be.revertedWithCustomError(escrow, 'NotAParty');

    await escrow.connect(contractor).declareDispute(1);
    expect((await escrow.getEscrow(1)).status).to.equal(1n); // Disputed

    // re-declaring on a disputed case reverts
    await expect(escrow.connect(employer).declareDispute(1))
      .to.be.revertedWithCustomError(escrow, 'NotActive');
  });

  it('lets the council resolve a disputed case (refund path)', async function () {
    const { escrow, admin, employer } = await fundedFixture();

    await escrow.connect(employer).declareDispute(1);
    await escrow.connect(admin).releaseFunds(1, true);

    expect((await escrow.getEscrow(1)).status).to.equal(3n); // RefundedToEmployer
  });
});
