import { parseAbi } from "viem";

/**
 * MUSD protocol (Mezo's Liquity-style CDP) on Mezo testnet — the contracts that *create* MUSD
 * against BTC collateral. Addresses verified on-chain 2026-11-14 (Blockscout-verified proxies):
 *   BorrowerOperations.borrowerOperationsSignaturesAddress() == BorrowerOperationsSignatures
 *   BorrowerOperations.sortedTroves()                         == SortedTroves
 *   BorrowerOperations.interestRateManager()                  == InterestRateManager
 * Parameters read the same day: MCR 110%, CCR 150%, min net debt 1,800 MUSD, gas compensation
 * 200 MUSD, borrowing fee 0.1%, new-trove interest 1.00% APR. Never hard-code those in maths —
 * read them live (see src/lib/client/mezo.ts); they are governable.
 */
export const MEZO_PROTOCOL = {
  BorrowerOperations: "0xCdF7028ceAB81fA0C6971208e83fa7872994beE5",
  BorrowerOperationsSignatures: "0xD757e3646AF370b15f32EB557F0F8380Df7D639e",
  TroveManager: "0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0",
  PriceFeed: "0x86bCF0841622a5dAC14A313a15f96A95421b9366",
  SortedTroves: "0x722E4D24FD6Ff8b0AC679450F3D91294607268fA",
  InterestRateManager: "0xD4D6c36A592A2c5e86035A6bca1d57747a567f37",
  StabilityPool: "0x1CCA7E410eE41739792eA0A24e00349Dd247680e",
} as const satisfies Record<string, `0x${string}`>;

/** Mezo's own app — for faucet / full trove management outside MUSD Split. */
export const MEZO_LINKS = {
  faucet: "https://faucet.test.mezo.org",
  app: "https://testnet.mezo.org",
  docs: "https://mezo.org/docs",
};

/** TroveManager.Troves(...).status */
export const TROVE_STATUS = ["nonExistent", "active", "closedByOwner", "closedByLiquidation", "closedByRedemption"] as const;

export const borrowerOperationsAbi = parseAbi([
  "function MCR() view returns (uint256)",
  "function CCR() view returns (uint256)",
  "function minNetDebt() view returns (uint256)",
  "function MUSD_GAS_COMPENSATION() view returns (uint256)",
  "function borrowingRate() view returns (uint256)",
  "function getBorrowingFee(uint256 _debt) view returns (uint256)",
  "function openTrove(uint256 _debtAmount, address _upperHint, address _lowerHint) payable",
  "function addColl(address _upperHint, address _lowerHint) payable",
  "function withdrawMUSD(uint256 _amount, address _upperHint, address _lowerHint)",
  "function repayMUSD(uint256 _amount, address _upperHint, address _lowerHint)",
  "function adjustTrove(uint256 _collWithdrawal, uint256 _debtChange, bool _isDebtIncrease, address _upperHint, address _lowerHint) payable",
  "event TroveUpdated(address indexed _borrower, uint256 _principal, uint256 _interest, uint256 _coll, uint256 _stake, uint16 _interestRate, uint256 _lastInterestUpdateTime, uint8 _operation)",
  "event TroveCreated(address indexed _borrower, uint256 arrayIndex)",
  "event BorrowingFeePaid(address indexed _borrower, uint256 _fee)",
]);

export const borrowerOperationsSignaturesAbi = parseAbi([
  "function getNonce(address user) view returns (uint256)",
  "function eip712Domain() view returns (bytes1 fields, string name, string version, uint256 chainId, address verifyingContract, bytes32 salt, uint256[] extensions)",
  "function withdrawMUSDWithSignature(uint256 _amount, address _upperHint, address _lowerHint, address _borrower, address _recipient, bytes _signature, uint256 _deadline)",
]);

export const troveManagerAbi = parseAbi([
  "function Troves(address) view returns (uint256 coll, uint256 principal, uint256 interestOwed, uint256 stake, uint8 status, uint16 interestRate, uint256 lastInterestUpdateTime, uint256 maxBorrowingCapacity, uint128 arrayIndex)",
  "function getEntireDebtAndColl(address _borrower) view returns (uint256 coll, uint256 principal, uint256 interest, uint256 pendingCollateral, uint256 pendingPrincipal, uint256 pendingInterest)",
  "function getCurrentICR(address _borrower, uint256 _price) view returns (uint256)",
  "function getTroveStatus(address _borrower) view returns (uint8)",
  "function getTCR(uint256 _price) view returns (uint256)",
  "function checkRecoveryMode(uint256 _price) view returns (bool)",
]);

export const priceFeedAbi = parseAbi(["function fetchPrice() view returns (uint256)"]);

export const sortedTrovesAbi = parseAbi([
  "function findInsertPosition(uint256 _NICR, address _prevId, address _nextId) view returns (address, address)",
  "function getSize() view returns (uint256)",
]);

export const interestRateManagerAbi = parseAbi(["function interestRate() view returns (uint16)"]);

/** EIP-712 type used by BorrowerOperationsSignatures.withdrawMUSDWithSignature (read from verified source). */
export const WITHDRAW_MUSD_TYPES = {
  WithdrawMUSD: [
    { name: "amount", type: "uint256" },
    { name: "borrower", type: "address" },
    { name: "recipient", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;
