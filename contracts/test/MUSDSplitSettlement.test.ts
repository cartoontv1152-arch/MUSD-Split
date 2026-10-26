import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { MockMUSD, MUSDSplitSettlement } from "../typechain-types";

const UNIT = 10n ** 18n;
const id = (label: string) => ethers.id(label); // keccak256 of a label -> bytes32

async function signPermit(
  token: MockMUSD,
  owner: HardhatEthersSigner,
  spender: string,
  value: bigint,
  deadline: bigint,
) {
  const { chainId } = await ethers.provider.getNetwork();
  const nonce = await token.nonces(owner.address);
  const domain = {
    name: await token.name(),
    version: "1",
    chainId,
    verifyingContract: await token.getAddress(),
  };
  const types = {
    Permit: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };
  const sig = await owner.signTypedData(domain, types, {
    owner: owner.address,
    spender,
    value,
    nonce,
    deadline,
  });
  return ethers.Signature.from(sig);
}

describe("MUSDSplitSettlement", () => {
  async function deployFixture() {
    const [deployer, alice, bob, charlie, mallory] = await ethers.getSigners();
    const musd = (await ethers.deployContract("MockMUSD")) as unknown as MockMUSD;
    const settlement = (await ethers.deployContract("MUSDSplitSettlement", [
      await musd.getAddress(),
    ])) as unknown as MUSDSplitSettlement;
    const settlementAddr = await settlement.getAddress();
    for (const s of [alice, bob, charlie, mallory]) {
      await musd.mint(s.address, 1_000n * UNIT);
    }
    return { deployer, alice, bob, charlie, mallory, musd, settlement, settlementAddr };
  }

  describe("deployment", () => {
    it("stores the MUSD token and has no admin surface", async () => {
      const { musd, settlement } = await loadFixture(deployFixture);
      expect(await settlement.musd()).to.equal(await musd.getAddress());
      expect(await settlement.MAX_BATCH()).to.equal(32n);
      const fragments = settlement.interface.fragments
        .filter((f) => f.type === "function")
        .map((f) => (f as { name: string }).name);
      for (const forbidden of ["owner", "transferOwnership", "withdraw", "rescue", "pause"]) {
        expect(fragments).to.not.include(forbidden);
      }
    });

    it("rejects the zero address as token", async () => {
      const factory = await ethers.getContractFactory("MUSDSplitSettlement");
      await expect(factory.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(factory, "InvalidToken");
    });
  });

  describe("settle", () => {
    it("moves MUSD payer -> creditor directly and emits Settled", async () => {
      const { alice, bob, musd, settlement, settlementAddr } = await loadFixture(deployFixture);
      const amount = 30n * UNIT;
      await musd.connect(bob).approve(settlementAddr, amount);
      const sid = id("settlement-1");

      await expect(settlement.connect(bob).settle(sid, alice.address, amount))
        .to.emit(settlement, "Settled")
        .withArgs(sid, bob.address, alice.address, amount)
        .and.to.emit(musd, "Transfer")
        .withArgs(bob.address, alice.address, amount);

      expect(await musd.balanceOf(bob.address)).to.equal(970n * UNIT);
      expect(await musd.balanceOf(alice.address)).to.equal(1_030n * UNIT);
      expect(await musd.balanceOf(settlementAddr)).to.equal(0n);
      expect(await settlement.isSettled(bob.address, sid)).to.equal(true);
      expect(await settlement.settled(await settlement.settlementKey(bob.address, sid))).to.equal(true);
      expect(await musd.allowance(bob.address, settlementAddr)).to.equal(0n);
    });

    it("computes settlementKey as keccak256(abi.encode(payer, id))", async () => {
      const { bob, settlement } = await loadFixture(deployFixture);
      const sid = id("k");
      const expected = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(["address", "bytes32"], [bob.address, sid]),
      );
      expect(await settlement.settlementKey(bob.address, sid)).to.equal(expected);
    });

    it("blocks a duplicate settlement id for the same payer", async () => {
      const { alice, bob, musd, settlement, settlementAddr } = await loadFixture(deployFixture);
      await musd.connect(bob).approve(settlementAddr, 100n * UNIT);
      const sid = id("dup");
      await settlement.connect(bob).settle(sid, alice.address, 10n * UNIT);
      await expect(settlement.connect(bob).settle(sid, alice.address, 10n * UNIT))
        .to.be.revertedWithCustomError(settlement, "AlreadySettled")
        .withArgs(sid);
      expect(await musd.balanceOf(alice.address)).to.equal(1_010n * UNIT);
    });

    it("scopes ids per payer, so another payer cannot grief an id", async () => {
      const { alice, bob, mallory, musd, settlement, settlementAddr } = await loadFixture(deployFixture);
      const sid = id("shared-id");
      await musd.connect(mallory).approve(settlementAddr, 1n);
      // Mallory front-runs with Bob's id; it only consumes Mallory's own key.
      await settlement.connect(mallory).settle(sid, alice.address, 1n);
      expect(await settlement.isSettled(bob.address, sid)).to.equal(false);

      await musd.connect(bob).approve(settlementAddr, 30n * UNIT);
      await expect(settlement.connect(bob).settle(sid, alice.address, 30n * UNIT))
        .to.emit(settlement, "Settled")
        .withArgs(sid, bob.address, alice.address, 30n * UNIT);
      expect(await settlement.isSettled(bob.address, sid)).to.equal(true);
    });

    it("rejects a zero settlement id", async () => {
      const { alice, bob, musd, settlement, settlementAddr } = await loadFixture(deployFixture);
      await musd.connect(bob).approve(settlementAddr, UNIT);
      await expect(
        settlement.connect(bob).settle(ethers.ZeroHash, alice.address, UNIT),
      ).to.be.revertedWithCustomError(settlement, "InvalidSettlementId");
    });

    it("rejects a zero amount", async () => {
      const { alice, bob, settlement } = await loadFixture(deployFixture);
      await expect(settlement.connect(bob).settle(id("z"), alice.address, 0)).to.be.revertedWithCustomError(
        settlement,
        "InvalidAmount",
      );
    });

    it("rejects invalid recipients: zero, self, the contract, the token", async () => {
      const { bob, musd, settlement, settlementAddr } = await loadFixture(deployFixture);
      await musd.connect(bob).approve(settlementAddr, 100n * UNIT);
      const bad = [ethers.ZeroAddress, bob.address, settlementAddr, await musd.getAddress()];
      for (const [i, to] of bad.entries()) {
        await expect(settlement.connect(bob).settle(id(`bad-${i}`), to, UNIT)).to.be.revertedWithCustomError(
          settlement,
          "InvalidRecipient",
        );
      }
    });

    it("reverts without allowance and does not mark the id settled", async () => {
      const { alice, bob, musd, settlement, settlementAddr } = await loadFixture(deployFixture);
      const sid = id("no-allowance");
      await expect(settlement.connect(bob).settle(sid, alice.address, UNIT)).to.be.revertedWithCustomError(
        musd,
        "ERC20InsufficientAllowance",
      );
      expect(await settlement.isSettled(bob.address, sid)).to.equal(false);
      await musd.connect(bob).approve(settlementAddr, UNIT / 2n);
      await expect(settlement.connect(bob).settle(sid, alice.address, UNIT)).to.be.revertedWithCustomError(
        musd,
        "ERC20InsufficientAllowance",
      );
      expect(await settlement.isSettled(bob.address, sid)).to.equal(false);
    });

    it("reverts on insufficient balance and does not mark the id settled", async () => {
      const { alice, bob, musd, settlement, settlementAddr } = await loadFixture(deployFixture);
      const sid = id("no-balance");
      await musd.connect(bob).approve(settlementAddr, ethers.MaxUint256);
      await expect(
        settlement.connect(bob).settle(sid, alice.address, 1_001n * UNIT),
      ).to.be.revertedWithCustomError(musd, "ERC20InsufficientBalance");
      expect(await settlement.isSettled(bob.address, sid)).to.equal(false);
    });

    it("blocks reentrancy from a malicious token", async () => {
      const { alice, bob } = await loadFixture(deployFixture);
      const evil = await ethers.deployContract("ReentrantToken");
      const settlement = await ethers.deployContract("MUSDSplitSettlement", [await evil.getAddress()]);
      const settlementAddr = await settlement.getAddress();
      await evil.mint(bob.address, 100n * UNIT);
      await evil.connect(bob).approve(settlementAddr, 100n * UNIT);
      await evil.arm(settlementAddr);
      await expect(
        settlement.connect(bob).settle(id("outer"), alice.address, UNIT),
      ).to.be.revertedWithCustomError(settlement, "ReentrancyGuardReentrantCall");
      expect(await settlement.isSettled(bob.address, id("outer"))).to.equal(false);
    });
  });

  describe("settleWithPermit", () => {
    it("settles in one transaction with an EIP-2612 signature", async () => {
      const { alice, bob, musd, settlement, settlementAddr } = await loadFixture(deployFixture);
      const amount = 30n * UNIT;
      const deadline = BigInt(await time.latest()) + 3600n;
      const sig = await signPermit(musd, bob, settlementAddr, amount, deadline);
      const sid = id("permit-1");

      await expect(
        settlement.connect(bob).settleWithPermit(sid, alice.address, amount, deadline, sig.v, sig.r, sig.s),
      )
        .to.emit(settlement, "Settled")
        .withArgs(sid, bob.address, alice.address, amount);
      expect(await musd.balanceOf(alice.address)).to.equal(1_030n * UNIT);
      expect(await musd.balanceOf(settlementAddr)).to.equal(0n);
      expect(await musd.nonces(bob.address)).to.equal(1n);
      expect(await musd.allowance(bob.address, settlementAddr)).to.equal(0n);
    });

    it("still succeeds when the permit was front-run (allowance already set)", async () => {
      const { alice, bob, mallory, musd, settlement, settlementAddr } = await loadFixture(deployFixture);
      const amount = 12n * UNIT;
      const deadline = BigInt(await time.latest()) + 3600n;
      const sig = await signPermit(musd, bob, settlementAddr, amount, deadline);
      // Mallory submits Bob's permit first.
      await musd.connect(mallory).permit(bob.address, settlementAddr, amount, deadline, sig.v, sig.r, sig.s);

      const sid = id("frontrun");
      await expect(
        settlement.connect(bob).settleWithPermit(sid, alice.address, amount, deadline, sig.v, sig.r, sig.s),
      )
        .to.emit(settlement, "Settled")
        .withArgs(sid, bob.address, alice.address, amount);
      expect(await musd.balanceOf(alice.address)).to.equal(1_012n * UNIT);
    });

    it("reverts with an expired permit and no allowance", async () => {
      const { alice, bob, musd, settlement, settlementAddr } = await loadFixture(deployFixture);
      const amount = 5n * UNIT;
      const deadline = BigInt(await time.latest()) - 1n;
      const sig = await signPermit(musd, bob, settlementAddr, amount, deadline);
      const sid = id("expired");
      await expect(
        settlement.connect(bob).settleWithPermit(sid, alice.address, amount, deadline, sig.v, sig.r, sig.s),
      ).to.be.revertedWithCustomError(musd, "ERC20InsufficientAllowance");
      expect(await settlement.isSettled(bob.address, sid)).to.equal(false);
    });

    it("reverts with a permit signed by someone else", async () => {
      const { alice, bob, mallory, musd, settlement, settlementAddr } = await loadFixture(deployFixture);
      const amount = 5n * UNIT;
      const deadline = BigInt(await time.latest()) + 3600n;
      // Mallory signs a permit, Bob tries to use it for his own transfer.
      const sig = await signPermit(musd, mallory, settlementAddr, amount, deadline);
      await expect(
        settlement
          .connect(bob)
          .settleWithPermit(id("forged"), alice.address, amount, deadline, sig.v, sig.r, sig.s),
      ).to.be.revertedWithCustomError(musd, "ERC20InsufficientAllowance");
    });

    it("cannot replay a settlement id through the permit path", async () => {
      const { alice, bob, musd, settlement, settlementAddr } = await loadFixture(deployFixture);
      const amount = 2n * UNIT;
      const deadline = BigInt(await time.latest()) + 3600n;
      const sid = id("permit-dup");
      let sig = await signPermit(musd, bob, settlementAddr, amount, deadline);
      await settlement.connect(bob).settleWithPermit(sid, alice.address, amount, deadline, sig.v, sig.r, sig.s);
      sig = await signPermit(musd, bob, settlementAddr, amount, deadline);
      await expect(
        settlement.connect(bob).settleWithPermit(sid, alice.address, amount, deadline, sig.v, sig.r, sig.s),
      )
        .to.be.revertedWithCustomError(settlement, "AlreadySettled")
        .withArgs(sid);
    });
  });

  describe("settleBatch", () => {
    it("settles several debts to several creditors in one transaction", async () => {
      const { alice, bob, charlie, musd, settlement, settlementAddr } = await loadFixture(deployFixture);
      await musd.connect(charlie).approve(settlementAddr, 50n * UNIT);
      const ids = [id("b-1"), id("b-2")];
      const tx = settlement
        .connect(charlie)
        .settleBatch(ids, [alice.address, bob.address], [20n * UNIT, 30n * UNIT]);
      await expect(tx)
        .to.emit(settlement, "Settled")
        .withArgs(ids[0], charlie.address, alice.address, 20n * UNIT)
        .and.to.emit(settlement, "Settled")
        .withArgs(ids[1], charlie.address, bob.address, 30n * UNIT);
      expect(await musd.balanceOf(charlie.address)).to.equal(950n * UNIT);
      expect(await musd.balanceOf(alice.address)).to.equal(1_020n * UNIT);
      expect(await musd.balanceOf(bob.address)).to.equal(1_030n * UNIT);
      expect(await musd.balanceOf(settlementAddr)).to.equal(0n);
      expect(await settlement.isSettled(charlie.address, ids[0])).to.equal(true);
      expect(await settlement.isSettled(charlie.address, ids[1])).to.equal(true);
    });

    it("rejects length mismatches", async () => {
      const { alice, charlie, settlement } = await loadFixture(deployFixture);
      await expect(
        settlement.connect(charlie).settleBatch([id("a"), id("b")], [alice.address], [UNIT, UNIT]),
      ).to.be.revertedWithCustomError(settlement, "LengthMismatch");
      await expect(
        settlement.connect(charlie).settleBatch([id("a")], [alice.address], [UNIT, UNIT]),
      ).to.be.revertedWithCustomError(settlement, "LengthMismatch");
    });

    it("rejects an empty batch", async () => {
      const { charlie, settlement } = await loadFixture(deployFixture);
      await expect(settlement.connect(charlie).settleBatch([], [], [])).to.be.revertedWithCustomError(
        settlement,
        "EmptyBatch",
      );
    });

    it("rejects batches larger than 32", async () => {
      const { alice, charlie, settlement } = await loadFixture(deployFixture);
      const n = 33;
      const ids = Array.from({ length: n }, (_, i) => id(`big-${i}`));
      await expect(
        settlement
          .connect(charlie)
          .settleBatch(ids, Array(n).fill(alice.address), Array(n).fill(1n)),
      ).to.be.revertedWithCustomError(settlement, "BatchTooLarge");
    });

    it("accepts exactly 32 items", async () => {
      const { alice, charlie, musd, settlement, settlementAddr } = await loadFixture(deployFixture);
      const n = 32;
      await musd.connect(charlie).approve(settlementAddr, BigInt(n));
      const ids = Array.from({ length: n }, (_, i) => id(`max-${i}`));
      await settlement.connect(charlie).settleBatch(ids, Array(n).fill(alice.address), Array(n).fill(1n));
      expect(await settlement.isSettled(charlie.address, ids[31])).to.equal(true);
    });

    it("reverts atomically on a duplicate id inside the batch", async () => {
      const { alice, bob, charlie, musd, settlement, settlementAddr } = await loadFixture(deployFixture);
      await musd.connect(charlie).approve(settlementAddr, 100n * UNIT);
      const dup = id("dup-in-batch");
      await expect(
        settlement
          .connect(charlie)
          .settleBatch([dup, dup], [alice.address, bob.address], [UNIT, UNIT]),
      )
        .to.be.revertedWithCustomError(settlement, "AlreadySettled")
        .withArgs(dup);
      expect(await settlement.isSettled(charlie.address, dup)).to.equal(false);
      expect(await musd.balanceOf(charlie.address)).to.equal(1_000n * UNIT);
    });

    it("reverts atomically when one item is invalid", async () => {
      const { alice, charlie, musd, settlement, settlementAddr } = await loadFixture(deployFixture);
      await musd.connect(charlie).approve(settlementAddr, 100n * UNIT);
      const ids = [id("ok"), id("bad")];
      await expect(
        settlement.connect(charlie).settleBatch(ids, [alice.address, charlie.address], [UNIT, UNIT]),
      ).to.be.revertedWithCustomError(settlement, "InvalidRecipient");
      expect(await settlement.isSettled(charlie.address, ids[0])).to.equal(false);
      expect(await musd.balanceOf(alice.address)).to.equal(1_000n * UNIT);
    });

    it("rejects an id that was already settled individually", async () => {
      const { alice, bob, charlie, musd, settlement, settlementAddr } = await loadFixture(deployFixture);
      await musd.connect(charlie).approve(settlementAddr, 100n * UNIT);
      const sid = id("single-then-batch");
      await settlement.connect(charlie).settle(sid, alice.address, UNIT);
      await expect(
        settlement.connect(charlie).settleBatch([id("fresh"), sid], [bob.address, alice.address], [UNIT, UNIT]),
      )
        .to.be.revertedWithCustomError(settlement, "AlreadySettled")
        .withArgs(sid);
    });
  });

  describe("settleBatchWithPermit", () => {
    it("settles a batch with one permit for the total", async () => {
      const { alice, bob, charlie, musd, settlement, settlementAddr } = await loadFixture(deployFixture);
      const amounts = [7n * UNIT, 3n * UNIT];
      const total = amounts[0] + amounts[1];
      const deadline = BigInt(await time.latest()) + 3600n;
      const sig = await signPermit(musd, charlie, settlementAddr, total, deadline);
      const ids = [id("bp-1"), id("bp-2")];
      await expect(
        settlement
          .connect(charlie)
          .settleBatchWithPermit(ids, [alice.address, bob.address], amounts, deadline, sig.v, sig.r, sig.s),
      )
        .to.emit(settlement, "Settled")
        .withArgs(ids[0], charlie.address, alice.address, amounts[0])
        .and.to.emit(settlement, "Settled")
        .withArgs(ids[1], charlie.address, bob.address, amounts[1]);
      expect(await musd.balanceOf(charlie.address)).to.equal(990n * UNIT);
      expect(await musd.allowance(charlie.address, settlementAddr)).to.equal(0n);
      expect(await musd.balanceOf(settlementAddr)).to.equal(0n);
    });

    it("reverts when the permit covers less than the batch total", async () => {
      const { alice, bob, charlie, musd, settlement, settlementAddr } = await loadFixture(deployFixture);
      const amounts = [7n * UNIT, 3n * UNIT];
      const deadline = BigInt(await time.latest()) + 3600n;
      // Signed for 7 only; the contract asks for a permit of 10, so the signature is invalid.
      const sig = await signPermit(musd, charlie, settlementAddr, 7n * UNIT, deadline);
      await expect(
        settlement
          .connect(charlie)
          .settleBatchWithPermit(
            [id("u-1"), id("u-2")],
            [alice.address, bob.address],
            amounts,
            deadline,
            sig.v,
            sig.r,
            sig.s,
          ),
      ).to.be.revertedWithCustomError(musd, "ERC20InsufficientAllowance");
    });

    it("validates batch shape before touching the permit", async () => {
      const { alice, charlie, settlement } = await loadFixture(deployFixture);
      await expect(
        settlement
          .connect(charlie)
          .settleBatchWithPermit([], [], [], 0, 27, ethers.ZeroHash, ethers.ZeroHash),
      ).to.be.revertedWithCustomError(settlement, "EmptyBatch");
      await expect(
        settlement
          .connect(charlie)
          .settleBatchWithPermit([id("x")], [alice.address, alice.address], [1n], 0, 27, ethers.ZeroHash, ethers.ZeroHash),
      ).to.be.revertedWithCustomError(settlement, "LengthMismatch");
    });
  });
});
