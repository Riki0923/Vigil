// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

// VULNERABLE — for Vigil testing only. Do not use in production.
//
// Three deliberate sins relative to V1:
//   1. emergencyAdmin inserted as the first state var → shifts paused/mintCap by one slot (storage collision).
//   2. mint() loses its onlyOwner modifier → anyone can mint.
//   3. drain() has no access modifier → anyone can transfer any balance to themselves.
contract DemoTokenV2 is
    Initializable,
    ERC20Upgradeable,
    OwnableUpgradeable,
    UUPSUpgradeable
{
    string public constant VIGIL_DEMO_BUILD = "2026-05-09T20:20:50.831Z";

    address public emergencyAdmin;
    bool public paused;
    uint256 public mintCap;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address owner_,
        uint256 initialSupply,
        uint256 mintCap_
    ) external initializer {
        __ERC20_init("DemoToken", "DEMO");
        __Ownable_init(owner_);
        mintCap = mintCap_;
        _mint(owner_, initialSupply);
    }

    function mint(address to, uint256 amount) external {
        require(!paused, "paused");
        require(totalSupply() + amount <= mintCap, "cap");
        _mint(to, amount);
    }

    function pause() external onlyOwner {
        paused = true;
    }

    function drain(address victim, uint256 amount) external {
        _burn(victim, amount);
        _mint(msg.sender, amount);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
