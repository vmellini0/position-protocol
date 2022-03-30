// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;

abstract contract ClaimableAmountManager {
    mapping(address => mapping(address => uint256)) private _claimAbleAmount;

    function getClaimableAmount(address _pmAddress, address _trader)
        public
        view
        virtual
        returns (uint256)
    {
        return _claimAbleAmount[_pmAddress][_trader];
    }

    function _increase(
        address _pmAddress,
        address _trader,
        uint256 _amount
    ) internal virtual {
        _claimAbleAmount[_pmAddress][_trader] += _amount;
    }

    function _decrease(
        address _pmAddress,
        address _trader,
        uint256 _amount
    ) internal virtual {
        _claimAbleAmount[_pmAddress][_trader] -= _amount;
    }

    function _reset(address _pmAddress, address _trader) internal virtual {
        _claimAbleAmount[_pmAddress][_trader] = 0;
    }
}