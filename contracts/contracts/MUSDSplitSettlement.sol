// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title MUSDSplitSettlement
 * @notice Minimal, non-custodial settlement rail for MUSD Split.
 *
 * A payer settles an off-chain group debt by calling {settle} with a
 * server-issued `settlementId`. The contract pulls MUSD from the payer and
 * sends it straight to the creditor in the same call (`transferFrom(payer,
 * creditor)`), so it never holds funds. Each `(payer, settlementId)` pair can
 * be used exactly once, which makes a settlement duplicate-proof on-chain and
 * lets the app link a transaction to its ledger entry through the
 * {Settled} event.
 *
 * There is no owner, no admin, no upgradeability and no fee.
 */
contract MUSDSplitSettlement is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Maximum number of settlements accepted by one batch call.
    uint256 public constant MAX_BATCH = 32;

    /// @notice The MUSD token settled through this contract.
    IERC20 public immutable musd;

    /// @notice Consumed settlement keys, see {settlementKey}.
    mapping(bytes32 => bool) public settled;

    /// @notice Emitted once per settled debt.
    /// @param settlementId Off-chain settlement identifier issued by the app.
    /// @param from Payer (the caller).
    /// @param to Creditor that received the MUSD.
    /// @param amount MUSD amount in base units (18 decimals).
    event Settled(bytes32 indexed settlementId, address indexed from, address indexed to, uint256 amount);

    error AlreadySettled(bytes32 settlementId);
    error InvalidRecipient();
    error InvalidAmount();
    error InvalidSettlementId();
    error EmptyBatch();
    error LengthMismatch();
    error BatchTooLarge();
    error InvalidToken();

    /// @param musd_ Address of the MUSD token.
    constructor(address musd_) {
        if (musd_ == address(0)) revert InvalidToken();
        musd = IERC20(musd_);
    }

    /**
     * @notice Storage key for a settlement. Keys are scoped to the payer so
     * nobody can consume (grief) another payer's settlement id.
     */
    function settlementKey(address payer, bytes32 settlementId) public pure returns (bytes32) {
        return keccak256(abi.encode(payer, settlementId));
    }

    /// @notice Whether `payer` has already used `settlementId`.
    function isSettled(address payer, bytes32 settlementId) external view returns (bool) {
        return settled[settlementKey(payer, settlementId)];
    }

    /**
     * @notice Pay `amount` MUSD from the caller to `to` for `settlementId`.
     * @dev Requires a prior MUSD allowance to this contract of at least `amount`.
     */
    function settle(bytes32 settlementId, address to, uint256 amount) external nonReentrant {
        _settle(settlementId, msg.sender, to, amount);
    }

    /**
     * @notice Same as {settle}, but sets the allowance with an EIP-2612 permit
     * signed by the caller, so the whole payment is one transaction.
     * @dev The permit call is wrapped in try/catch: if someone front-runs and
     * consumes the permit, the allowance is already in place and the
     * settlement still succeeds. If neither worked, `transferFrom` reverts.
     */
    function settleWithPermit(
        bytes32 settlementId,
        address to,
        uint256 amount,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant {
        _permit(amount, deadline, v, r, s);
        _settle(settlementId, msg.sender, to, amount);
    }

    /**
     * @notice Settle several debts in one transaction. All-or-nothing.
     * @dev A repeated id inside the batch reverts with {AlreadySettled}.
     */
    function settleBatch(
        bytes32[] calldata settlementIds,
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external nonReentrant {
        _checkBatch(settlementIds, recipients, amounts);
        _settleBatch(settlementIds, recipients, amounts);
    }

    /**
     * @notice {settleBatch} with a single EIP-2612 permit for the batch total.
     */
    function settleBatchWithPermit(
        bytes32[] calldata settlementIds,
        address[] calldata recipients,
        uint256[] calldata amounts,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant {
        _checkBatch(settlementIds, recipients, amounts);
        uint256 total;
        for (uint256 i = 0; i < amounts.length; ++i) {
            total += amounts[i];
        }
        _permit(total, deadline, v, r, s);
        _settleBatch(settlementIds, recipients, amounts);
    }

    function _settleBatch(
        bytes32[] calldata settlementIds,
        address[] calldata recipients,
        uint256[] calldata amounts
    ) private {
        for (uint256 i = 0; i < settlementIds.length; ++i) {
            _settle(settlementIds[i], msg.sender, recipients[i], amounts[i]);
        }
    }

    function _checkBatch(
        bytes32[] calldata settlementIds,
        address[] calldata recipients,
        uint256[] calldata amounts
    ) private pure {
        uint256 n = settlementIds.length;
        if (n == 0) revert EmptyBatch();
        if (n > MAX_BATCH) revert BatchTooLarge();
        if (recipients.length != n || amounts.length != n) revert LengthMismatch();
    }

    function _permit(uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) private {
        try IERC20Permit(address(musd)).permit(msg.sender, address(this), value, deadline, v, r, s) {} catch {}
    }

    /// @dev Checks -> effects -> interaction. Funds move payer -> creditor directly.
    function _settle(bytes32 settlementId, address from, address to, uint256 amount) private {
        if (settlementId == bytes32(0)) revert InvalidSettlementId();
        if (to == address(0) || to == from || to == address(this) || to == address(musd)) revert InvalidRecipient();
        if (amount == 0) revert InvalidAmount();

        bytes32 key = settlementKey(from, settlementId);
        if (settled[key]) revert AlreadySettled(settlementId);
        settled[key] = true;

        musd.safeTransferFrom(from, to, amount);

        emit Settled(settlementId, from, to, amount);
    }
}
