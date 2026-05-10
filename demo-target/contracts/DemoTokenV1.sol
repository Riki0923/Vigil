// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

contract DemoTokenV1 is
    Initializable,
    ERC20Upgradeable,
    OwnableUpgradeable,
    UUPSUpgradeable
{
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
        __ERC20_init("Vigil Token", "VIGIL");
        __Ownable_init(owner_);
        mintCap = mintCap_;
        _mint(owner_, initialSupply);
    }

    function mint(address to, uint256 amount) external onlyOwner {
        require(!paused, "paused");
        require(totalSupply() + amount <= mintCap, "cap");
        _mint(to, amount);
    }

    function pause() external onlyOwner {
        paused = true;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
