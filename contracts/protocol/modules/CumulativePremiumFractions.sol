// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;

import "../libraries/position/Position.sol";

abstract contract CumulativePremiumFractions {

    // Cumulative premium fraction
    mapping(address => int128[]) private cumulativePremiumFractions;

    event FundingPaid(int256 premiumFraction, int256 newestCumulativePremiumFraction,address positionManager, address caller ,uint256 blockTimestamp);


    function payFunding(IPositionManager _positionManager) public {
        address _pmAddress = address(_positionManager);
        int256 premiumFraction = _positionManager.settleFunding();
        int128 newestCumulativePremiumFraction = int128(premiumFraction) + getLatestCumulativePremiumFraction(
            _pmAddress
        );
        cumulativePremiumFractions[_pmAddress].push(
            newestCumulativePremiumFraction
        );
        emit FundingPaid(
            premiumFraction,
            newestCumulativePremiumFraction,
            address(_positionManager),
            msg.sender,
            block.timestamp
        );

    }

    function getLatestCumulativePremiumFraction(address _positionManager)
        public
        view
        virtual
        returns (int128)
    {
        // save gas
        int128[] memory _fractions = cumulativePremiumFractions[
            _positionManager
        ];
        uint256 len = _fractions.length;
        if (len > 0) {
            return _fractions[len - 1];
        }
        return 0;
    }

    function getCumulativePremiumFractions(address _pmAddress)
        public
        view
        virtual
        returns (int128[] memory)
    {
        return cumulativePremiumFractions[_pmAddress];
    }


    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[49] private __gap;
}
