/**
 * Deploy script for IslamicEscrow.
 *
 *   Local :  npx hardhat node
 *            npm run deploy:local
 *   Sepolia: npm run deploy:sepolia   (requires .env: RPC_URL_SEPOLIA + ADMIN_PRIVATE_KEY)
 *
 * After deployment the script writes deployments/<network>.json and prints
 * the CONTRACT_ADDRESS you must copy into your .env file.
 */
const fs = require('fs');
const path = require('path');
const { ethers, network } = require('hardhat');

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log('Network  :', network.name, `(chainId ${network.config.chainId ?? '-'})`);
  console.log('Deployer :', deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log('Balance  :', ethers.formatEther(balance), 'ETH');
  if (balance === 0n && network.name !== 'hardhat' && network.name !== 'localhost') {
    throw new Error('Deployer has no ETH — get Sepolia ETH from a faucet first (see README).');
  }

  console.log('Deploying IslamicEscrow…');
  const factory = await ethers.getContractFactory('IslamicEscrow');
  const contract = await factory.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  const txHash = contract.deploymentTransaction() ? contract.deploymentTransaction().hash : null;

  console.log('--------------------------------------------------');
  console.log('IslamicEscrow deployed at:', address);
  console.log('Deployment tx           :', txHash);
  console.log('Max deposit (safe margin):', ethers.formatEther(await contract.MAX_DEPOSIT()), 'ETH');
  console.log('Owner (platform حَکَم)    :', await contract.owner());
  console.log('--------------------------------------------------');

  const dir = path.join(__dirname, '..', 'deployments');
  fs.mkdirSync(dir, { recursive: true });
  const record = {
    network: network.name,
    contractName: 'IslamicEscrow',
    address,
    txHash,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(dir, `${network.name}.json`), JSON.stringify(record, null, 2));
  console.log(`Saved → deployments/${network.name}.json`);
  console.log(`\nNext step: add this line to your .env file:\n  CONTRACT_ADDRESS=${address}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
