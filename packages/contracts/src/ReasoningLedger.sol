// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title ReasoningLedger
/// @notice On-chain, tamper-evident record of Candor's risk verdicts on financial
///         intents (swaps, RWA-pool allocations). Candor's backend risk engine —
///         a deterministic rule pass for clearly-safe requests, a Claude tool-call
///         adjudication for borderline ones — computes a verdict for every intent
///         *before* the user is offered a transaction to sign. This contract does
///         not hold funds and does not execute anything; it exists purely so the
///         agent's judgment quality is publicly auditable over time, separate from
///         whether the user ultimately followed it.
///
/// @dev Design choices, deliberately kept simple for auditability:
///      - Full evidence (risk features, rationale text) lives off-chain; only a
///        keccak256 commitment is anchored here, so anyone holding the original
///        evidence can prove it matches what was recorded, without paying L2
///        storage costs for strings.
///      - `recordVerdict` is restricted to a single `agentSigner` address (the
///        backend's dedicated signing key) — this ledger attests "this agent
///        said X", not "anyone can claim the agent said X". The signer key is
///        rotatable by the contract owner without losing history.
///      - Aggregate counters are updated in the same call so the Track Record
///        page can read a cheap summary (`getStats`) without an indexer or
///        scanning event logs, while the full per-entry history is still
///        available via `VerdictRecorded` events and `getEntry`.
contract ReasoningLedger is Ownable2Step {
    enum Verdict {
        EXECUTE,
        EXECUTE_SMALLER,
        WAIT,
        REJECT
    }

    struct Entry {
        bytes32 intentHash; // keccak256 commitment of the parsed intent + user + chain
        bytes32 evidenceHash; // keccak256 commitment of the risk features + rationale text
        Verdict verdict;
        uint8 riskScore; // 0-100
        bool overrode; // true if the user proceeded against a non-EXECUTE verdict
        address user;
        uint64 timestamp;
    }

    /// @notice The backend signer authorized to anchor verdicts. Rotatable by owner.
    address public agentSigner;

    /// @dev Sequential entries, append-only.
    Entry[] private entries;

    /// @dev intentHash => index+1 in `entries` (0 means "not recorded"), so a
    ///      caller holding an intentHash can look up its entry directly.
    mapping(bytes32 => uint256) private entryIndexByIntentHash;

    uint256 public executeCount;
    uint256 public executeSmallerCount;
    uint256 public waitCount;
    uint256 public rejectCount;
    uint256 public overrodeCount;

    event VerdictRecorded(
        uint256 indexed entryId,
        bytes32 indexed intentHash,
        bytes32 evidenceHash,
        Verdict verdict,
        uint8 riskScore,
        bool overrode,
        address indexed user,
        uint64 timestamp
    );

    event AgentSignerUpdated(address indexed previousSigner, address indexed newSigner);

    error NotAgentSigner();
    error ZeroAddress();
    error IntentAlreadyRecorded(bytes32 intentHash);
    error InvalidRiskScore(uint8 riskScore);

    modifier onlyAgentSigner() {
        if (msg.sender != agentSigner) revert NotAgentSigner();
        _;
    }

    constructor(address initialOwner, address initialAgentSigner) Ownable(initialOwner) {
        if (initialAgentSigner == address(0)) revert ZeroAddress();
        agentSigner = initialAgentSigner;
        emit AgentSignerUpdated(address(0), initialAgentSigner);
    }

    /// @notice Anchor a risk verdict for one intent. Called by the backend
    ///         immediately after the confirm card is shown (or, for overrides,
    ///         immediately after the user proceeds anyway) — either way, within
    ///         the same few-second request/confirm cycle, not after the fact.
    /// @param intentHash keccak256 commitment identifying the intent (unique per request).
    /// @param evidenceHash keccak256 commitment of the full risk features + rationale.
    /// @param verdict The verdict the risk engine returned.
    /// @param riskScore 0-100 risk score backing the verdict.
    /// @param overrode Whether the user executed anyway despite a non-EXECUTE verdict.
    /// @param user The end user the intent belongs to.
    function recordVerdict(
        bytes32 intentHash,
        bytes32 evidenceHash,
        Verdict verdict,
        uint8 riskScore,
        bool overrode,
        address user
    ) external onlyAgentSigner returns (uint256 entryId) {
        if (entryIndexByIntentHash[intentHash] != 0) revert IntentAlreadyRecorded(intentHash);
        if (riskScore > 100) revert InvalidRiskScore(riskScore);
        if (user == address(0)) revert ZeroAddress();

        uint64 timestamp = uint64(block.timestamp);

        entries.push(
            Entry({
                intentHash: intentHash,
                evidenceHash: evidenceHash,
                verdict: verdict,
                riskScore: riskScore,
                overrode: overrode,
                user: user,
                timestamp: timestamp
            })
        );
        entryId = entries.length - 1;
        entryIndexByIntentHash[intentHash] = entries.length; // store as len (index+1)

        if (verdict == Verdict.EXECUTE) {
            unchecked { ++executeCount; }
        } else if (verdict == Verdict.EXECUTE_SMALLER) {
            unchecked { ++executeSmallerCount; }
        } else if (verdict == Verdict.WAIT) {
            unchecked { ++waitCount; }
        } else {
            unchecked { ++rejectCount; }
        }
        if (overrode) {
            unchecked { ++overrodeCount; }
        }

        emit VerdictRecorded(entryId, intentHash, evidenceHash, verdict, riskScore, overrode, user, timestamp);
    }

    /// @notice Rotate the backend signer authorized to record verdicts, without
    ///         losing any prior history — a key compromise doesn't invalidate
    ///         the ledger's past entries, it just changes who can add new ones.
    function setAgentSigner(address newSigner) external onlyOwner {
        if (newSigner == address(0)) revert ZeroAddress();
        emit AgentSignerUpdated(agentSigner, newSigner);
        agentSigner = newSigner;
    }

    function totalEntries() external view returns (uint256) {
        return entries.length;
    }

    function getEntry(uint256 entryId) external view returns (Entry memory) {
        return entries[entryId];
    }

    /// @notice Look up an entry by its intent hash. Reverts implicitly (index 0)
    ///         if no entry exists — callers should check `hasEntry` first if the
    ///         intentHash's existence is uncertain.
    function getEntryByIntentHash(bytes32 intentHash) external view returns (Entry memory) {
        uint256 idx = entryIndexByIntentHash[intentHash];
        require(idx != 0, "no entry for intentHash");
        return entries[idx - 1];
    }

    function hasEntry(bytes32 intentHash) external view returns (bool) {
        return entryIndexByIntentHash[intentHash] != 0;
    }

    /// @notice Cheap aggregate read for the Track Record page — no indexer needed.
    function getStats()
        external
        view
        returns (
            uint256 totalVerdicts,
            uint256 execute_,
            uint256 executeSmaller_,
            uint256 wait_,
            uint256 reject_,
            uint256 overrode_
        )
    {
        totalVerdicts = entries.length;
        execute_ = executeCount;
        executeSmaller_ = executeSmallerCount;
        wait_ = waitCount;
        reject_ = rejectCount;
        overrode_ = overrodeCount;
    }
}
