// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title  IslamicEscrow
 * @notice MVP escrow + arbitration contract for HakamChain (حَکَم‌چین).
 *
 *         Flow:
 *           1. The employer (کارفرما) locks funds in the contract via
 *              `createEscrow`, naming the contractor (مجری).
 *           2. If a dispute arises, one of the parties calls `declareDispute`.
 *           3. The HakamChain platform — acting as the Islamic-arbitration
 *              council (حاکمیت قضایی فقهی / حَکَم) — reviews the evidence
 *              off-chain and executes the ruling on-chain by calling
 *              `releaseFunds`, which pays either the employer (refund /
 *              بازپرداخت) or the contractor (release / آزادسازی وجه).
 *
 *         Safe margin (حاشیه امن):
 *           A single deposit is hard-capped at MAX_DEPOSIT (0.05 ETH) so
 *           nobody can lose meaningful funds while testing on Sepolia.
 *
 *         Privacy by design:
 *           No case documents live on-chain; the backend stores only
 *           SHA-256 hashes of evidence files. The chain only ever sees
 *           amounts, addresses and the final ruling.
 *
 * @dev    THIS IS A TESTNET DEMO (Ethereum Sepolia). Do not use with real
 *         funds. The owner key is a hot key held by the backend service.
 */
contract IslamicEscrow is Ownable, ReentrancyGuard {
    /// @dev Safe margin for the demo: maximum amount lockable per escrow.
    uint256 public constant MAX_DEPOSIT = 0.05 ether;

    enum Status {
        Funded,               // 0 — funds locked, no open dispute
        Disputed,             // 1 — a party declared a dispute, council reviewing
        ReleasedToContractor, // 2 — council ruled in favor of the contractor
        RefundedToEmployer    // 3 — council ruled in favor of the employer
    }

    struct Escrow {
        uint256 id;
        address employer;   // کارفرما — deposited the funds
        address contractor; // مجری   — contracted to deliver
        uint256 amount;     // locked amount in wei (zeroed after settlement)
        Status status;
        uint256 createdAt;
    }

    uint256 public nextEscrowId = 1;
    mapping(uint256 => Escrow) public escrows;

    // ------------------------------------------------------------------
    // Events: deposit / release / refund / dispute
    // ------------------------------------------------------------------
    event EscrowFunded(uint256 indexed id, address indexed employer, address indexed contractor, uint256 amount);
    event FundsReleased(uint256 indexed id, address indexed contractor, uint256 amount);
    event FundRefunded(uint256 indexed id, address indexed employer, uint256 amount);
    event DisputeDeclared(uint256 indexed id, address indexed by);

    // Custom errors (cheaper than require strings)
    error ZeroDeposit();
    error DepositTooHigh(uint256 sent, uint256 max);
    error InvalidParty();
    error NotAParty();
    error NotActive();
    error NothingToRelease();
    error TransferFailed();

    constructor() Ownable(msg.sender) {}

    /**
     * @notice Employer locks funds for a specific contractor (واریز وجه).
     * @param  contractor Address of the مجری who will deliver the work.
     * @return id The escrow/case id on-chain.
     */
    function createEscrow(address contractor) external payable nonReentrant returns (uint256 id) {
        if (msg.value == 0) revert ZeroDeposit();
        // Safe margin: cap every deposit so testnet users cannot lose much.
        if (msg.value > MAX_DEPOSIT) revert DepositTooHigh(msg.value, MAX_DEPOSIT);
        if (contractor == address(0) || contractor == msg.sender) revert InvalidParty();

        id = nextEscrowId++;
        escrows[id] = Escrow({
            id: id,
            employer: msg.sender,
            contractor: contractor,
            amount: msg.value,
            status: Status.Funded,
            createdAt: block.timestamp
        });

        emit EscrowFunded(id, msg.sender, contractor, msg.value);
    }

    /**
     * @notice One of the two parties formally declares a dispute (اعلام اختلاف).
     */
    function declareDispute(uint256 id) external {
        Escrow storage e = escrows[id];
        if (msg.sender != e.employer && msg.sender != e.contractor) revert NotAParty();
        if (e.status != Status.Funded) revert NotActive();

        e.status = Status.Disputed;
        emit DisputeDeclared(id, msg.sender);
    }

    /**
     * @notice Platform (حَکَم) executes the ruling after the fiqh review.
     * @param  id         Escrow id.
     * @param  toEmployer true  -> refund the employer  (بازپرداخت به کارفرما)
     *                     false -> release to the contractor (آزادسازی به مجری)
     * @dev   Only the platform admin wallet (owner) may call this.
     */
    function releaseFunds(uint256 id, bool toEmployer) external onlyOwner nonReentrant {
        Escrow storage e = escrows[id];
        if (e.status != Status.Funded && e.status != Status.Disputed) revert NothingToRelease();

        address winner = toEmployer ? e.employer : e.contractor;
        uint256 amount = e.amount;

        e.status = toEmployer ? Status.RefundedToEmployer : Status.ReleasedToContractor;
        e.amount = 0;

        (bool ok, ) = winner.call{value: amount}("");
        if (!ok) revert TransferFailed();

        if (toEmployer) {
            emit FundRefunded(id, winner, amount);
        } else {
            emit FundsReleased(id, winner, amount);
        }
    }

    /// @notice Read helper used by the backend to inspect an escrow.
    function getEscrow(uint256 id) external view returns (Escrow memory) {
        return escrows[id];
    }

    // NOTE: no receive()/fallback() — accidental direct ETH transfers revert.
}
