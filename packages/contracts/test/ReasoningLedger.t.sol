// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReasoningLedger} from "../src/ReasoningLedger.sol";

contract ReasoningLedgerTest is Test {
    ReasoningLedger internal ledger;

    address internal owner = makeAddr("owner");
    address internal agentSigner = makeAddr("agentSigner");
    address internal user = makeAddr("user");
    address internal stranger = makeAddr("stranger");

    function setUp() public {
        ledger = new ReasoningLedger(owner, agentSigner);
    }

    function _hash(string memory seed) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(seed));
    }

    // -- recording ------------------------------------------------------

    function test_recordVerdict_byAgentSigner_succeeds() public {
        bytes32 intentHash = _hash("intent-1");
        bytes32 evidenceHash = _hash("evidence-1");

        vm.prank(agentSigner);
        uint256 entryId = ledger.recordVerdict(intentHash, evidenceHash, ReasoningLedger.Verdict.EXECUTE, 12, false, user);

        assertEq(entryId, 0);
        assertEq(ledger.totalEntries(), 1);
        assertTrue(ledger.hasEntry(intentHash));

        ReasoningLedger.Entry memory e = ledger.getEntry(0);
        assertEq(e.intentHash, intentHash);
        assertEq(e.evidenceHash, evidenceHash);
        assertEq(uint8(e.verdict), uint8(ReasoningLedger.Verdict.EXECUTE));
        assertEq(e.riskScore, 12);
        assertFalse(e.overrode);
        assertEq(e.user, user);
    }

    function test_recordVerdict_byNonSigner_reverts() public {
        vm.prank(stranger);
        vm.expectRevert(ReasoningLedger.NotAgentSigner.selector);
        ledger.recordVerdict(_hash("x"), _hash("y"), ReasoningLedger.Verdict.EXECUTE, 0, false, user);
    }

    function test_recordVerdict_duplicateIntentHash_reverts() public {
        bytes32 intentHash = _hash("dup");
        vm.startPrank(agentSigner);
        ledger.recordVerdict(intentHash, _hash("e1"), ReasoningLedger.Verdict.EXECUTE, 5, false, user);

        vm.expectRevert(abi.encodeWithSelector(ReasoningLedger.IntentAlreadyRecorded.selector, intentHash));
        ledger.recordVerdict(intentHash, _hash("e2"), ReasoningLedger.Verdict.WAIT, 60, false, user);
        vm.stopPrank();
    }

    function test_recordVerdict_riskScoreOver100_reverts() public {
        vm.prank(agentSigner);
        vm.expectRevert(abi.encodeWithSelector(ReasoningLedger.InvalidRiskScore.selector, 101));
        ledger.recordVerdict(_hash("i"), _hash("e"), ReasoningLedger.Verdict.REJECT, 101, false, user);
    }

    function test_recordVerdict_zeroUser_reverts() public {
        vm.prank(agentSigner);
        vm.expectRevert(ReasoningLedger.ZeroAddress.selector);
        ledger.recordVerdict(_hash("i"), _hash("e"), ReasoningLedger.Verdict.REJECT, 10, false, address(0));
    }

    // -- aggregate counters -----------------------------------------------

    function test_getStats_tracksEachVerdictType() public {
        vm.startPrank(agentSigner);
        ledger.recordVerdict(_hash("1"), _hash("e1"), ReasoningLedger.Verdict.EXECUTE, 5, false, user);
        ledger.recordVerdict(_hash("2"), _hash("e2"), ReasoningLedger.Verdict.EXECUTE_SMALLER, 40, true, user);
        ledger.recordVerdict(_hash("3"), _hash("e3"), ReasoningLedger.Verdict.WAIT, 55, false, user);
        ledger.recordVerdict(_hash("4"), _hash("e4"), ReasoningLedger.Verdict.REJECT, 90, true, user);
        vm.stopPrank();

        (uint256 total, uint256 exec, uint256 execSmaller, uint256 wait_, uint256 reject_, uint256 overrode) =
            ledger.getStats();

        assertEq(total, 4);
        assertEq(exec, 1);
        assertEq(execSmaller, 1);
        assertEq(wait_, 1);
        assertEq(reject_, 1);
        assertEq(overrode, 2);
    }

    function test_getEntryByIntentHash_matchesGetEntry() public {
        bytes32 intentHash = _hash("lookup");
        vm.prank(agentSigner);
        ledger.recordVerdict(intentHash, _hash("e"), ReasoningLedger.Verdict.WAIT, 33, false, user);

        ReasoningLedger.Entry memory byHash = ledger.getEntryByIntentHash(intentHash);
        ReasoningLedger.Entry memory byId = ledger.getEntry(0);
        assertEq(byHash.intentHash, byId.intentHash);
        assertEq(byHash.riskScore, byId.riskScore);
    }

    // -- signer rotation ----------------------------------------------------

    function test_onlyOwner_canRotateAgentSigner() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        ledger.setAgentSigner(stranger);
    }

    function test_rotateAgentSigner_oldSignerLosesAccess_newSignerGainsIt() public {
        address newSigner = makeAddr("newSigner");
        vm.prank(owner);
        ledger.setAgentSigner(newSigner);

        vm.prank(agentSigner);
        vm.expectRevert(ReasoningLedger.NotAgentSigner.selector);
        ledger.recordVerdict(_hash("i"), _hash("e"), ReasoningLedger.Verdict.EXECUTE, 1, false, user);

        vm.prank(newSigner);
        ledger.recordVerdict(_hash("i"), _hash("e"), ReasoningLedger.Verdict.EXECUTE, 1, false, user);
        assertEq(ledger.totalEntries(), 1);
    }

    function test_rotateSigner_preservesPriorHistory() public {
        vm.prank(agentSigner);
        ledger.recordVerdict(_hash("old-entry"), _hash("e"), ReasoningLedger.Verdict.EXECUTE, 1, false, user);

        vm.prank(owner);
        ledger.setAgentSigner(makeAddr("newSigner"));

        assertEq(ledger.totalEntries(), 1);
        assertTrue(ledger.hasEntry(_hash("old-entry")));
    }

    // -- fuzz: entryId always matches insertion order ------------------------

    function test_fuzz_entryIdsAreSequential(uint8 n) public {
        n = uint8(bound(n, 1, 40));
        vm.startPrank(agentSigner);
        for (uint256 i = 0; i < n; i++) {
            uint256 id = ledger.recordVerdict(
                keccak256(abi.encodePacked("seed", i)), _hash("e"), ReasoningLedger.Verdict.EXECUTE, 1, false, user
            );
            assertEq(id, i);
        }
        vm.stopPrank();
        assertEq(ledger.totalEntries(), n);
    }
}
