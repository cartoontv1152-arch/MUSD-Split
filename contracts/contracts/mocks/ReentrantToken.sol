// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface ISettlement {
    function settle(bytes32 settlementId, address to, uint256 amount) external;
}

/// @dev Test-only malicious token: re-enters the settlement contract from transferFrom.
contract ReentrantToken is ERC20 {
    ISettlement public target;
    bool public attack;

    constructor() ERC20("Evil", "EVL") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(address target_) external {
        target = ISettlement(target_);
        attack = true;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        if (attack) {
            attack = false;
            // Re-enter while the outer settle() is still executing.
            target.settle(keccak256("reenter"), to, amount);
        }
        return super.transferFrom(from, to, amount);
    }
}
