import {BigNumber, BigNumberish, ContractFactory, Signer, Wallet} from 'ethers'
import {ethers, waffle} from 'hardhat'
// import {PositionHouse} from "../../typeChain";
import {loadFixture} from "ethereum-waffle";
// import checkObservationEquals from "../../shared/checkObservationEquals";
// import snapshotGasCost from "../../shared/snapshotGasCost";
// import {expect} from "../../shared/expect";
// import {TEST_POOL_START_TIME} from "../../shared/fixtures";
import {describe} from "mocha";
import {expect} from 'chai'
import {PositionManager, PositionHouse} from "../../typeChain";
import {
    ClaimFund,
    LimitOrderReturns,
    PositionData,
    PositionLimitOrderID,
    ChangePriceParams,
    priceToPip, SIDE,
    toWeiBN,
    toWeiWithString, ExpectTestCaseParams, ExpectMaintenanceDetail
} from "../shared/utilities";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {CHAINLINK_ABI_TESTNET} from "../../constants";
import PositionManagerTestingTool from "../shared/positionManagerTestingTool";

import PositionHouseTestingTool from "../shared/positionHouseTestingTool";


describe("PositionHouse_02", () => {
    let positionHouse: PositionHouse;
    let trader0: any;
    let trader1: any;
    let trader2: any;
    let trader3: any;
    let trader4: any;
    let trader5: any;
    let tradercp: any;
    let positionManager: PositionManager;
    let positionManagerFactory: ContractFactory;

    beforeEach(async () => {
        [trader0, trader1, trader2, trader3, trader4, trader5, tradercp] = await ethers.getSigners()
        const positionHouseFunction = await ethers.getContractFactory('PositionHouseFunction')
        const libraryIns = (await positionHouseFunction.deploy())

        positionManagerFactory = await ethers.getContractFactory("PositionManager")
        positionManager = (await positionManagerFactory.deploy()) as unknown as PositionManager;
        const factory = await ethers.getContractFactory("PositionHouse", {
            libraries: {
                PositionHouseFunction: libraryIns.address
                // unsafeAllowLinkedLibraries : true
            }
        })
        positionHouse = (await factory.deploy()) as unknown as PositionHouse;
        await positionManager.initialize(BigNumber.from(500000), '0xd364238D7eC81547a38E3bF4CBB5206605A15Fee', ethers.utils.formatBytes32String('BTC'), BigNumber.from(100), BigNumber.from(10000), BigNumber.from(10000), BigNumber.from(3000), BigNumber.from(1000), '0x5741306c21795FdCBb9b265Ea0255F499DFe515C'.toLowerCase(), positionHouse.address);
        await positionHouse.initialize(BigNumber.from(3), BigNumber.from(80), BigNumber.from(3), BigNumber.from(20), '0xf1d0e7be179cb21f0e6bfe3616a3d7bce2f18aef'.toLowerCase(), '0x0000000000000000000000000000000000000000')
    })

    const openMarketPosition = async ({
                                          quantity,
                                          leverage,
                                          side,
                                          trader,
                                          instanceTrader,
                                          expectedMargin,
                                          expectedNotional,
                                          expectedSize,
                                          price = 5000,
                                          _positionManager = positionManager
                                      }: {
        quantity: BigNumber,
        leverage: number,
        side: number,
        trader?: string,
        instanceTrader: any,
        expectedMargin?: BigNumber,
        expectedNotional?: BigNumber | string,
        expectedSize?: BigNumber,
        price?: number,
        _positionManager?: any
    }) => {
        trader = instanceTrader && instanceTrader.address || trader
        if (!trader) throw new Error("No trader")
        const tx = await positionHouse.connect(instanceTrader).openMarketPosition(
            _positionManager.address,
            side,
            quantity,
            leverage,
        )
        console.log("GAS USED MARKET", (await tx.wait()).gasUsed.toString())
    }

    interface OpenLimitPositionAndExpectParams {
        _trader?: SignerWithAddress
        limitPrice: number | string
        leverage: number,
        quantity: number
        side: number
        _positionManager?: PositionManager
    }

    async function getOrderIdByTx(tx: any) {
        const receipt = await tx.wait();
        const orderId = ((receipt?.events || [])[1]?.args || [])['orderId']
        const priceLimit = ((receipt?.events || [])[1]?.args || [])['priceLimit']
        return {
            orderId,
            priceLimit,
        }
    }

    async function openLimitPositionAndExpect({
                                                  _trader,
                                                  limitPrice,
                                                  leverage,
                                                  quantity,
                                                  side,
                                                  _positionManager
                                              }: OpenLimitPositionAndExpectParams): Promise<LimitOrderReturns> {
        _positionManager = _positionManager || positionManager
        _trader = _trader || trader0
        if (!_positionManager) throw Error("No position manager")
        if (!_trader) throw Error("No trader")
        const tx = await positionHouse.connect(_trader).openLimitOrder(_positionManager.address, side, quantity, priceToPip(Number(limitPrice)), leverage)
        console.log("GAS USED LIMIT", (await tx.wait()).gasUsed.toString())
        const {orderId, priceLimit} = await getOrderIdByTx(tx)

        return {
            orderId: orderId,
            pip: priceToPip(Number(limitPrice))
        } as LimitOrderReturns
        // expect(positionLimitInOrder..div(10000)).eq(limitPrice);
    }

    async function liquidate(_positionManagerAddress, _traderAddress) {
        await positionHouse.liquidate(_positionManagerAddress, _traderAddress)
    }

    async function getMaintenanceDetailAndExpect({
                                                     positionManagerAddress,
                                                     traderAddress,
                                                     expectedMarginRatio,
                                                     expectedMaintenanceMargin,
                                                     expectedMarginBalance
                                                 }: ExpectMaintenanceDetail) {
        const maintenanceData = await positionHouse.getMaintenanceDetail(positionManagerAddress, traderAddress);
        expect(maintenanceData.marginRatio).eq(expectedMarginRatio);
        expect(maintenanceData.maintenanceMargin).eq(expectedMaintenanceMargin);
        expect(maintenanceData.marginBalance).eq(expectedMarginBalance);
    }


    async function changePrice({
                                   limitPrice,
                                   toHigherPrice
                               }: ChangePriceParams) {
        if (toHigherPrice) {
            let response1 = (await openLimitPositionAndExpect({
                limitPrice: limitPrice,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 3,
                _trader: tradercp,
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('3'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: tradercp.address,
                    instanceTrader: tradercp,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from(0)
                }
            );
        } else {
            let response1 = (await openLimitPositionAndExpect({
                limitPrice: limitPrice,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 3,
                _trader: tradercp,
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('3'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: tradercp.address,
                    instanceTrader: tradercp,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from(0)
                }
            );
        }
    }

    async function expectMarginPnlAndOP({
                                            positionManagerAddress,
                                            traderAddress,
                                            expectedOpenNotional,
                                            expectedMargin,
                                            expectedPnl = undefined,
                                            expectedQuantity = 0
                                        }: ExpectTestCaseParams) {
        const positionNotionalAndPnLTrader = await positionHouse.getPositionNotionalAndUnrealizedPnl(
            positionManagerAddress,
            traderAddress,
            1,
            {
                quantity: 0,
                margin: 0,
                openNotional: 0,
                lastUpdatedCumulativePremiumFraction: 0,
                blockNumber: 0,
                leverage: 0,
            }
        )
        const positionTrader = (await positionHouse.getPosition(positionManagerAddress, traderAddress)) as unknown as PositionData
        console.log("expect all: quantity, openNotional, positionNotional, margin, unrealizedPnl", Number(positionTrader.quantity), Number(positionTrader.openNotional), Number(positionNotionalAndPnLTrader.positionNotional), Number(positionTrader.margin), Number(positionNotionalAndPnLTrader.unrealizedPnl))
        if (expectedQuantity != 0) {
            expect(positionTrader.quantity).eq(expectedQuantity);
        }
        if (expectedOpenNotional != undefined) expect(positionNotionalAndPnLTrader.unrealizedPnl).eq(expectedPnl)
        expect(positionTrader.openNotional).eq(expectedOpenNotional);
        expect(positionTrader.margin).eq(expectedMargin);
        return true;
    }

    const closePosition = async ({
                                     trader,
                                     instanceTrader,
                                     _positionManager = positionManager,
                                     _percentQuantity = 100
                                 }: {
        trader: string,
        instanceTrader: any,
        _positionManager?: any,
        _percentQuantity?: any
    }) => {
        const positionData1 = (await positionHouse.connect(instanceTrader).getPosition(_positionManager.address, trader)) as unknown as PositionData;
        await positionHouse.connect(instanceTrader).closePosition(_positionManager.address, _percentQuantity);

        const positionData = (await positionHouse.getPosition(_positionManager.address, trader)) as unknown as PositionData;
        expect(positionData.margin).eq(0);
        expect(positionData.quantity).eq(0);
    }

    describe('Increase size in order', async () => {

        /**
         * Code: PS_FUTU_21
         - S1: Trade0 open Limit Long(4980,8)
         - S2: Trade1 open Market SHORT(8)
         - S3: Trade2 open Limit Long(4950,7)
         - S4: Trade1 open market SHORT(5)
         - S5: Trade0 open Limit Long(4900,6)
         - S6: Trade1 open Market SHORT(5)
         - S7: Trade3 open Market SHORT(1)
         - S8: Trade2 open Limit Long(4850,4)=>  2
         - S9: Trade3 open Market SHORT(4)

         - S10: Trade(cp1) open Limit short(5000,2)
         - S11: Trade(cp2) open Market long(2)
         */
        it('PS_FUTU_21 increase size by market order and limit order', async () => {
            console.log('****** Step 1 and Step 2')
            let response1 = (await openLimitPositionAndExpect({
                limitPrice: 4980,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 800,
                _trader: trader0
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('800'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader0.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,

                }
            );


            console.log('****** Step 3 and Step 4')

            let response2 = (await openLimitPositionAndExpect({
                limitPrice: 4950,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 700,
                _trader: trader2
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('500'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,

                }
            );


            console.log('****** Step 5 and Step 6')

            let response3 = (await openLimitPositionAndExpect({
                limitPrice: 4900,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 600,
                _trader: trader0
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('500'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,

                }
            );


            console.log('****** Step 7 and Step 8')

            await openMarketPosition({
                    quantity: BigNumber.from('100'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader3.address,
                    instanceTrader: trader3,
                    _positionManager: positionManager,

                }
            );

            let response4 = (await openLimitPositionAndExpect({
                limitPrice: 4850,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 400,
                _trader: trader2
            })) as unknown as PositionLimitOrderID


            console.log('****** Step 9')

            await openMarketPosition({
                    quantity: BigNumber.from('400'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader3.address,
                    instanceTrader: trader3,
                    _positionManager: positionManager,
                    expectedNotional: BigNumber.from('2440000')
                }
            );

            console.log('****** Step 10 and 11')

            await changePrice({
                limitPrice: 5000,
                toHigherPrice: true
            })

            console.log("before expect trader0");
            const expectTrader0 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader0.address,
                expectedOpenNotional: 6924000,
                expectedMargin: 692400,
                expectedPnl: 76000
            });

            console.log("before expect trader1");
            const expectTrader1 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedOpenNotional: 8919000,
                expectedMargin: 891900,
                expectedPnl: -81000
            });

            console.log("before expect trader2");
            const expectTrader2 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader2.address,
                expectedOpenNotional: 4435000,
                expectedMargin: 443500,
                expectedPnl: 65000
            });

            console.log("before expect trader3");
            const expectTrader3 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader3.address,
                expectedOpenNotional: 2440000,
                expectedMargin: 244000,
                expectedPnl: -60000
            });
        })

    })

    describe('Market reverse Market > Limit reverse Limit', async () => {

        /**
         PS_FUTU_22
         -S1: Trade0 open Limit Long(4980,15)
         -S2: Trade1 open Market SHORT(11)
         -S3: Trade0 open Limit Short(5000,3)
         -S4: Trade2 open MARKET LONG(3)

         -S5: Trade3 open Limit SHORT(5010,5)
         -S6: Trade1 open MARKET LONG(4)
         -S7: Trade0 open Limit Short(5020,2)=> have 1
         -S8: Trade1 open MARKET LONG(2)

         -S9: Trade2 open MARKET SHORT(1)
         -S10: Trade3 open Limit long(4970,2)
         -S11: Trade4 open Market SHORT(5)

         - S12: Trade(cp1) open Limit LONG(4950,2)
         - S13: Trade(cp2) open Market SHORT(2)
         */

        it('PS_FUTU_22: Market reverse Market; Limit reverse Limit', async () => {

            // ******************************
            //-S1: Trade0 open Limit Long(4980,15)
            //-S2: Trade1 open Market SHORT(11)
            let response1 = (await openLimitPositionAndExpect({
                limitPrice: 4980,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 1500,
                _trader: trader0
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('1100'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,

                }
            );


            // *****************************
            //-S3: Trade0 open Limit Short(5000,3)
            //-S4: Trade2 open MARKET LONG(3)
            let response2 = (await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 300,
                _trader: trader0
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('300'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,

                }
            );


            // *****************************
            //-S5: Trade3 open Limit SHORT(5010,5)
            //-S6: Trade1 open MARKET LONG(4)
            let response3 = (await openLimitPositionAndExpect({
                limitPrice: 5010,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 500,
                _trader: trader3
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('400'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,

                }
            );


            // *****************************
            //-S7: Trade0 open Limit Short(5020,2)=> have 1
            //-S8: Trade1 open MARKET LONG(2)
            let response4 = (await openLimitPositionAndExpect({
                limitPrice: 5020,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 200,
                _trader: trader0
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('200'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,

                }
            );

            // *****************************
            //-S9: Trade2 open Market Short(1)
            //-S10: Trade3 open Limit Long(4970, 2)
            //-S11: Trade4 open MARKET Short(5)
            await openMarketPosition({
                    quantity: BigNumber.from('100'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('200')
                }
            );

            let response5 = (await openLimitPositionAndExpect({
                limitPrice: 4970,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 200,
                _trader: trader3
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('500'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader4.address,
                    instanceTrader: trader4,
                    _positionManager: positionManager,

                }
            );

            await changePrice({
                limitPrice: 4950,
                toHigherPrice: false
            })

            const expectTrader0 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader0.address,
                expectedOpenNotional: 5478000,
                expectedMargin: 547800,
                expectedPnl: -33000,
                expectedQuantity: 1100
            });

            const expectTrader1 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedOpenNotional: 2490000,
                expectedMargin: 249000,
                expectedPnl: 15000,
                expectedQuantity: -500
            });

            const expectTrader2 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader2.address,
                expectedOpenNotional: 1000000,
                expectedMargin: 100000,
                expectedPnl: -10000,
                expectedQuantity: 200
            });

            const expectTrader3 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader3.address,
                expectedOpenNotional: 1503000,
                expectedMargin: 150300,
                expectedPnl: 18000,
                expectedQuantity: -300
            });
        })


        /**
         PS_FUTU_24
         -S1: Trade0 open Limit Long(4950,10)
         -S2: Trade1 open Market Short(9)
         -S3: Trade2 open Limit Short(5005,7)
         -S4: Trade1 open Market LONG(3)
         -S5: Trade0 open Limit Short(5010,2)
         -S6: Trade1 open Market LONG(6)
         -S7: Trade2 open Limit Long(5000,3)
         -S8: Trade0 open Market Short(4)
         -S9: Trade3 open Limit Long(4900,4)
         -S10: Trade2 open Market SHORT(2)
         -S11: Trade3 open MARKET SHORT(2)

         -S12: Trade(cp) open Limit short(5008,3)
         -S13: Trade(cp1) open Market long(3)
         */
        it('PS_FUTU_24', async () => {

            // ******************************
            //-S1: Trade0 open Limit Long(4950,10)
            //-S2: Trade1 open Market Short(9)
            let response1 = (await openLimitPositionAndExpect({
                limitPrice: 4950,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 10,
                _trader: trader0
            })) as unknown as PositionLimitOrderID
            console.log("done step 1")
            await openMarketPosition({
                    quantity: BigNumber.from('9'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,

                }
            );

            console.log("done step 2")

            // ******************************
            //-S3: Trade2 open Limit Short(5005,7)
            //-S4: Trade1 open Market LONG(3)
            let response2 = (await openLimitPositionAndExpect({
                limitPrice: 5005,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 7,
                _trader: trader2
            })) as unknown as PositionLimitOrderID
            console.log("done step 3")

            await openMarketPosition({
                    quantity: BigNumber.from('3'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,

                }
            );
            console.log("done step 4")


            // ******************************
            //-S5: Trade0 open Limit Short(5010,2)
            //-S6: Trade1 open Market LONG(6)
            let response3 = (await openLimitPositionAndExpect({
                limitPrice: 5010,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 2,
                _trader: trader0
            })) as unknown as PositionLimitOrderID
            console.log("done step 5")

            await openMarketPosition({
                    quantity: BigNumber.from('6'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,

                }
            );
            console.log("done step 6")

            const expectTrader1AfterS6 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedOpenNotional: 0,
                expectedMargin: 0,
                expectedPnl: 0,
            });

            // ******************************
            //-S7: Trade2 open Limit Long(5000,3)
            //-S8: Trade0 open Market Short(4)
            let response4 = (await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 3,
                _trader: trader2
            })) as unknown as PositionLimitOrderID
            console.log("done step 7")

            await openMarketPosition({
                    quantity: BigNumber.from('4'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader0.address,
                    instanceTrader: trader0,
                    _positionManager: positionManager,

                }
            );
            console.log("done step 8")

            const expectTrader2AfterS8 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader2.address,
                expectedOpenNotional: 20020,
                expectedMargin: 2002,
                expectedPnl: 220,
                expectedQuantity: -4
            });

            const expectTrader0AfterS8 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader0.address,
                expectedOpenNotional: 19800,
                expectedMargin: 1980,
                expectedPnl: 0,
                expectedQuantity: 4
            });

            // ******************************
            //-S9: Trade3 open Limit Long(4900,4)
            //-S10: Trade2 open Market SHORT(2)
            //-S11: Trade3 open MARKET SHORT(2)
            let response5 = (await openLimitPositionAndExpect({
                limitPrice: 4900,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 4,
                _trader: trader3
            })) as unknown as PositionLimitOrderID
            console.log("done step 9")

            await openMarketPosition({
                    quantity: BigNumber.from('2'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,

                }
            );
            console.log("done step 10")

            const expectTrader2AfterS10 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader2.address,
                expectedOpenNotional: 29820,
                expectedMargin: 2982,
                expectedPnl: 420,
                expectedQuantity: -6
            });

            await openMarketPosition({
                    quantity: BigNumber.from('2'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader3.address,
                    instanceTrader: trader3,
                    _positionManager: positionManager,

                }
            );
            console.log("done step 11")

            await changePrice({limitPrice: 5008, toHigherPrice: true})

            // ERROR because self-filled
            // const expectTrader3End = await expectMarginPnlAndOP({
            //     positionManagerAddress: positionManager.address,
            //     traderAddress: trader3.address,
            //     expectedOpenNotional: 9800,
            //     expectedMargin: 980,
            //     expectedPnl: 216,
            //     expectedQuantity: 2
            // });

        })


    })

    describe('openReversePosition old Quantity < new quantity  (Market reverse Market; Limit reverse Limit)', async () => {

        /**
         * PS_FUTU_23
         -S1: Trade0 open Limit Long(4980,10)
         -S2: Trade1 open Market SHORT(4)
         -S3: Trade0 open Limit Short(5000,9)
         -S4: Trade2 open MARKET LONG(6)

         -S5: Trade3 open Limit short(5010,5)
         -S6: Trade1 open MARKET LONG(8)
         -S7: Trade0 open Limit Long(4990,6)
         -S8: Trade1 open MARKET SHORT(5)

         -S9: Trade2 open MARKET SHORT(7)
         -S10: Trade3 open Limit long(4950,7)
         -S11: Trade4 open Market SHORT(7)

         - S12: Trade(ps1) open Limit SHORT (4970,2)
         - S13: Trade(ps2) open Market LONG(2)
         */
        it('PS_FUTU_23', async () => {

            // -S1: Trade0 open Limit Long(4980,10)
            // -S2: Trade1 open Market SHORT(4)
            let response1Trader0 = (await openLimitPositionAndExpect({
                limitPrice: 4980,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 10,
                _trader: trader0
            })) as unknown as PositionLimitOrderID
            console.log("done S1")

            await openMarketPosition({
                    quantity: BigNumber.from('4'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,

                }
            );
            console.log("done S2")
            // -S3: Trade0 open Limit Short(5000,9)
            // -S4: Trade2 open MARKET LONG(6)
            let response2Trader0 = (await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 9,
                _trader: trader0
            })) as unknown as PositionLimitOrderID
            console.log("done S3")
            await openMarketPosition({
                    quantity: BigNumber.from('6'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,

                }
            );
            console.log("done S4")
            // ERROR Pnl, margin and OP
            const expectTrader0AfterS4 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader0.address,
                expectedOpenNotional: 10000,
                expectedMargin: 1000,
                expectedPnl: 0,
                expectedQuantity: -2
            });

            // -S5: Trade3 open Limit short(5010,5)
            // -S6: Trade1 open MARKET LONG(8)
            let response1Trader3 = (await openLimitPositionAndExpect({
                limitPrice: 5010,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 5,
                _trader: trader3
            })) as unknown as PositionLimitOrderID
            console.log("done S5")
            await openMarketPosition({
                    quantity: BigNumber.from('8'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                }
            );
            console.log("done S6")
            // ERROR Pnl, margin and OP
            const expectTrader0AfterS6 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader0.address,
                expectedOpenNotional: 25000,
                expectedMargin: 2500,
                expectedPnl: -50,
                expectedQuantity: -5
            });

            // -S7: Trade0 open Limit Long(4990,6)
            // -S8: Trade1 open MARKET SHORT(5)
            let response3Trader0 = (await openLimitPositionAndExpect({
                limitPrice: 4990,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 6,
                _trader: trader0
            })) as unknown as PositionLimitOrderID
            console.log("done S7")

            await openMarketPosition({
                    quantity: BigNumber.from('5'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                }
            );
            console.log("done S8")

            // -S9: Trade2 open MARKET SHORT(7)
            // -S10: Trade3 open Limit long(4950,7)
            // -S11: Trade4 open Market SHORT(7)
            await openMarketPosition({
                    quantity: BigNumber.from('7'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );
            console.log("done S9")

            let response2Trader3 = (await openLimitPositionAndExpect({
                limitPrice: 4950,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 7,
                _trader: trader3
            })) as unknown as PositionLimitOrderID
            console.log("done S10")

            await openMarketPosition({
                    quantity: BigNumber.from('7'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader4.address,
                    instanceTrader: trader4,
                    _positionManager: positionManager,
                }
            );
            console.log("done S11")

            // - S12: Trade(ps1) open Limit SHORT (4970,2)
            // - S13: Trade(ps2) open Market LONG(2)
            await changePrice({
                limitPrice: 4970,
                toHigherPrice: true
            })
            // ERROR Pnl, margin and OP
            const expectTrader0End = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader0.address,
                expectedOpenNotional: 34870,
                expectedMargin: 3487,
                expectedPnl: -80,
                expectedQuantity: 7
            });

            // CORRECT
            const expectTrader1End = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedOpenNotional: 4990,
                expectedMargin: 499,
                expectedPnl: 20,
                expectedQuantity: -1
            });

            // CORRECT
            const expectTrader2End = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader2.address,
                expectedOpenNotional: 4980,
                expectedMargin: 498,
                expectedPnl: 10,
                expectedQuantity: -1
            });

            // ERROR Pnl, margin and OP
            const expectTrader3End = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader3.address,
                expectedOpenNotional: 9900,
                expectedMargin: 990,
                expectedPnl: 40,
                expectedQuantity: 2
            });
        })

        /**
         * PS_FUTU_25
         -S1: Trade0 open Limit Long(4950,7) => 3 left when end
         -S2: Trade1 open Market Short(4)
         -S3: Trade2 open Limit Short(5005,5)
         -S4: Trade1 open Market LONG(5)
         -S5: Trade0 open Limit Short(5010,7) => 1 left when end
         -S6: Trade1 open Market LONG(6)
         -S7: Trade2 open Limit Long(5000,7)
         -S8: Trade0 open Market short(5)
         -S9: Trade3 open Limit Long(4990,4)
         -S10: Trade2 open Market SHORT(2)
         -S11: Trade3 open MARKET SHORT(4)

         -S12: Trade(cp) open Limit short(5008,3)
         -S13: Trade(cp1) open Market long(3)
         */
        // it('PS_FUTU_25', async () => {
        //
        //     // *****************************
        //     //-S1: Trade0 open Limit Long(4950,7) => 3 left when end
        //     //-S2: Trade1 open Market Short(4)
        //     let response1 = (await openLimitPositionAndExpect({
        //         limitPrice: 4950,
        //         side: SIDE.LONG,
        //         leverage: 10,
        //         quantity: BigNumber.from('10000000000000000000'),
        //         _trader: trader0
        //     })) as unknown as PositionLimitOrderID
        //     console.log("done s1");
        //
        //     await openMarketPosition({
        //             quantity: BigNumber.from('9999500000000000000'),
        //             leverage: 10,
        //             side: SIDE.SHORT,
        //             trader: trader1.address,
        //             instanceTrader: trader1,
        //             _positionManager: positionManager,
        //         }
        //     );
        //     console.log("done s2");
        //
        //     const expectTrader0AfterS1 = await expectMarginPnlAndOP({
        //         positionManagerAddress: positionManager.address,
        //         traderAddress: trader0.address,
        //         expectedOpenNotional: 4950 * 9999500000000000000,
        //         expectedMargin: 4950 * 999950000000000000,
        //         expectedPnl: 0,
        //         expectedQuantity: 9999500000000000000
        //     });
        //
        //     // *****************************
        //     //-S3: Trade2 open Limit Short(5005,5)
        //     //-S4: Trade1 open Market LONG(5)
        //     let response2 = (await openLimitPositionAndExpect({
        //         limitPrice: 5005,
        //         side: SIDE.SHORT,
        //         leverage: 10,
        //         quantity: 500,
        //         _trader: trader2
        //     })) as unknown as PositionLimitOrderID
        //     console.log("done s3");
        //
        //     await openMarketPosition({
        //             quantity: BigNumber.from('500'),
        //             leverage: 10,
        //             side: SIDE.LONG,
        //             trader: trader1.address,
        //             instanceTrader: trader1,
        //             _positionManager: positionManager,
        //             expectedSize: BigNumber.from('1')
        //         }
        //     );
        //     console.log("done s4");
        //
        //     // *****************************
        //     //-S5: Trade0 open Limit Short(5010,7) => 1 left when end
        //     //-S6: Trade1 open Market LONG(6)
        //     let response3 = (await openLimitPositionAndExpect({
        //         limitPrice: 5010,
        //         side: SIDE.SHORT,
        //         leverage: 10,
        //         quantity: 700,
        //         _trader: trader0
        //     })) as unknown as PositionLimitOrderID
        //     console.log("done s5");
        //
        //     await openMarketPosition({
        //             quantity: BigNumber.from('600'),
        //             leverage: 10,
        //             side: SIDE.LONG,
        //             trader: trader1.address,
        //             instanceTrader: trader1,
        //             _positionManager: positionManager,
        //             expectedSize: BigNumber.from('7')
        //         }
        //     );
        //     console.log("done s6");
        //
        //     // ERROR expectedMargin should be 3506.5 but underflow
        //     const expectTrader1AfterS6 = await expectMarginPnlAndOP({
        //         positionManagerAddress: positionManager.address,
        //         traderAddress: trader1.address,
        //         expectedOpenNotional: 3506500,
        //         expectedMargin: 350650,
        //         expectedPnl: 500,
        //         expectedQuantity: 700
        //     });
        //
        //
        //     // *****************************
        //     //-S7: Trade2 open Limit Long(5000,7)
        //     //-S8: Trade0 open Market short(5)
        //     let response4 = (await openLimitPositionAndExpect({
        //         limitPrice: 5000,
        //         side: SIDE.LONG,
        //         leverage: 10,
        //         quantity: 700,
        //         _trader: trader2
        //     })) as unknown as PositionLimitOrderID
        //     console.log("done s7");
        //
        //     await openMarketPosition({
        //             quantity: BigNumber.from('500'),
        //             leverage: 10,
        //             side: SIDE.SHORT,
        //             trader: trader0.address,
        //             instanceTrader: trader0,
        //             _positionManager: positionManager,
        //         }
        //     );
        //     console.log("done s8");
        //
        //     // ERROR Pnl, margin and OP
        //     const expectTrader0 = await expectMarginPnlAndOP({
        //         positionManagerAddress: positionManager.address,
        //         traderAddress: trader0.address,
        //         expectedOpenNotional: 3502000,
        //         expectedMargin: 350200,
        //         expectedPnl: 2000,
        //         expectedQuantity: -700
        //     });
        //
        //
        //     // *****************************
        //     //-S9: Trade3 open Limit Long(4990,4)
        //     //-S10: Trade2 open Market SHORT(2)
        //     //-S11: Trade3 open MARKET SHORT(4)
        //     let response5 = (await openLimitPositionAndExpect({
        //         limitPrice: 4990,
        //         side: SIDE.LONG,
        //         leverage: 10,
        //         quantity: 400,
        //         _trader: trader3
        //     })) as unknown as PositionLimitOrderID
        //     console.log("done s9");
        //
        //     await openMarketPosition({
        //             quantity: BigNumber.from('200'),
        //             leverage: 10,
        //             side: SIDE.SHORT,
        //             trader: trader2.address,
        //             instanceTrader: trader2,
        //             _positionManager: positionManager,
        //         }
        //     );
        //     console.log("done s10");
        //
        //     // CORRECT
        //     const expectTrader2AfterS10 = await expectMarginPnlAndOP({
        //         positionManagerAddress: positionManager.address,
        //         traderAddress: trader2.address,
        //         expectedOpenNotional: 0,
        //         expectedMargin: 0,
        //         expectedPnl: 0,
        //         expectedQuantity: 0
        //     });
        //
        //     await openMarketPosition({
        //             quantity: BigNumber.from('4'),
        //             leverage: 10,
        //             side: SIDE.SHORT,
        //             trader: trader3.address,
        //             instanceTrader: trader3,
        //             _positionManager: positionManager,
        //         }
        //     );
        //     console.log("done s11");
        //
        //     await changePrice({limitPrice: 5008, toHigherPrice: true})
        //
        //     // ERROR Pnl, margin and OP
        //     const expectTrader0End = await expectMarginPnlAndOP({
        //         positionManagerAddress: positionManager.address,
        //         traderAddress: trader0.address,
        //         expectedOpenNotional: 3502000,
        //         expectedMargin: 350200,
        //         expectedPnl: -3600,
        //         expectedQuantity: -700
        //     });
        //
        //     // ERROR expectedMargin should be 3506.5 but underflow
        //     const expectTrader1End = await expectMarginPnlAndOP({
        //         positionManagerAddress: positionManager.address,
        //         traderAddress: trader1.address,
        //         expectedOpenNotional: 3506500,
        //         expectedMargin: 350650,
        //         expectedPnl: -900,
        //         expectedQuantity: 700
        //     });
        //
        // })

    })


    describe('Open Reverse + Increase', async () => {
        /**
         * PS_FUTU_26
         -S1: Trader0 open Limit Long(4950,7) => 1 left when end
         -S2: Trader1 open Limit short(5010,9)
         -S3: Trader2 open Market Short(6)
         -S4: Trader3 open Limit short(5020,8) => 1 left when end
         -S5: Trader1 open Market Long(12)
         -S6: Trader0 open Limit Long(5000,5)
         -S7: Trader1 open Market Short(4)
         -S8: Trader2 open Limit Long(4990,8)
         -S9: Trader0 open Market Short(9)
         -S10: Trader2 open Limit Short(5007,4)
         -S11: Trader3 open Market Long(8)

         -S12: Trader(cp) open Limit Long(5008,3)
         -S13: Trader(cp1) open Market SHORT(3)
         */

        it('PS_FUTU_26', async () => {

            // *****************************
            //-S1: Trader0 open Limit Long(4950,7) => 1 left when end
            //-S2: Trader1 open Limit short(5010,9)
            let response1 = (await openLimitPositionAndExpect({
                limitPrice: 4950,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 700,
                _trader: trader0
            })) as unknown as PositionLimitOrderID
            console.log("done s1");

            let response2 = (await openLimitPositionAndExpect({
                limitPrice: 5010,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 900,
                _trader: trader1
            })) as unknown as PositionLimitOrderID
            console.log("done s2");

            // *****************************
            // -S3: Trader2 open Market Short(6)
            // -S4: Trader3 open Limit short(5020,8) => 1 left when end
            await openMarketPosition({
                    quantity: BigNumber.from('600'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );
            console.log("done s3");

            let response3 = (await openLimitPositionAndExpect({
                limitPrice: 5020,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 800,
                _trader: trader3
            })) as unknown as PositionLimitOrderID
            console.log("done s4");

            // *****************************
            //-S5: Trader1 open Market Long(12)
            //-S6: Trader0 open Limit Long(5000,5)
            await openMarketPosition({
                    quantity: BigNumber.from('1200'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                }
            );
            console.log("done s5");

            let response4 = (await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 500,
                _trader: trader0
            })) as unknown as PositionLimitOrderID
            console.log("done s6");

            // *****************************
            //-S7: Trader1 open Market Short(4)
            //-S8: Trader2 open Limit Long(4990,8)
            await openMarketPosition({
                    quantity: BigNumber.from('400'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                }
            );
            console.log("done s7");

            const expectTrader1AfterS7 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedOpenNotional: 500000,
                expectedMargin: 50000,
                expectedPnl: 0,
                expectedQuantity: -100
            });

            let response5 = (await openLimitPositionAndExpect({
                limitPrice: 4990,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 800,
                _trader: trader2
            })) as unknown as PositionLimitOrderID
            console.log("done s8");


            // *****************************
            // -S9: Trader0 open Market Short(9)
            // -S10: Trader2 open Limit Short(5007,4)
            // -S11: Trader3 open Market Long(8)
            await openMarketPosition({
                    quantity: BigNumber.from('900'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader0.address,
                    instanceTrader: trader0,
                    _positionManager: positionManager
                }
            );
            console.log("done s9");

            const expectTrader2AfterS9 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader2.address,
                expectedOpenNotional: 998000,
                expectedMargin: 99800,
                expectedPnl: 0,
                expectedQuantity: 200
            });

            // ERROR because trader0 self-filled
            // const expectTrader0AfterS9 = await expectMarginPnlAndOP({
            //     positionManagerAddress: positionManager.address,
            //     traderAddress: trader0.address,
            //     expectedOpenNotional: 994000,
            //     expectedMargin: 99400,
            //     expectedPnl: 4000,
            //     expectedQuantity: 200
            // });

            let response6 = (await openLimitPositionAndExpect({
                limitPrice: 5007,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 400,
                _trader: trader2
            })) as unknown as PositionLimitOrderID
            console.log("done s10");

            await openMarketPosition({
                    quantity: BigNumber.from('800'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader3.address,
                    instanceTrader: trader3,
                    _positionManager: positionManager
                }
            );
            console.log("done s11");

            // ERROR Pnl, margin and ON
            // const expectTrader2AfterS11 = await expectMarginPnlAndOP({
            //     positionManagerAddress: positionManager.address,
            //     traderAddress: trader2.address,
            //     expectedOpenNotional: 1001400,
            //     expectedMargin: 100140 ,
            //     expectedPnl: 0,
            //     expectedQuantity : -200
            // });

            // ERROR because of self-filled
            // console.log("expectTrader3AfterS11")
            // const expectTrader3AfterS11 = await expectMarginPnlAndOP({
            //     positionManagerAddress: positionManager.address,
            //     traderAddress: trader3.address,
            //     expectedOpenNotional: 500700,
            //     expectedMargin: 50070,
            //     expectedPnl: -200,
            //     expectedQuantity: 100
            // });

            // -S12: Trader(cp) open Limit Long(5008,3)
            // -S13: Trader(cp1) open Market SHORT(3)
            // await changePrice({limitPrice: 5008, toHigherPrice: true})


        })

        /**
         * PS_FUTU_27
         -S1: Trader0 open Limit Short(5010,6)
         -S2: Trader1 open Limit Short(5020,7)
         -S3: Trader2 open Market Long(10)
         -S4: Trader3 open Limit Long(5000,6)
         -S5: Trader0 open Market Long(3)
         -S6: Trader1 open Market Short(5)
         -S7: Trader2 open Limit Short(5008,7)
         -S8: Trader3 open Market Long(2)
         -S9: Trader0 open Market Long(5)
         -S10: Trader1 open Limit Long(4990,6)
         -S11: Trader2 open Market Short(4)
         -S12: Trader3 open Market Short(3)

         - B13: Trader(cp) open Limit LONG(4980,2)
         - B14: Trader(cp) open MARKET SHORT(2)
         */
        it('PS_FUTU_27', async () => {


            // *****************************
            // -S1: Trader0 open Limit Short(5010,6)
            // -S2: Trader1 open Limit Short(5020,7)
            let response1 = (await openLimitPositionAndExpect({
                limitPrice: 5010,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 600,
                _trader: trader0
            })) as unknown as PositionLimitOrderID

            let response2 = (await openLimitPositionAndExpect({
                limitPrice: 5020,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 700,
                _trader: trader1
            })) as unknown as PositionLimitOrderID


            // *****************************
            //-S3: Trader2 open Market Long(10)
            //-S4: Trader3 open Limit Long(5000,6)
            await openMarketPosition({
                    quantity: BigNumber.from('1000'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );

            let response3 = (await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 600,
                _trader: trader3
            })) as unknown as PositionLimitOrderID


            // *****************************
            // -S5: Trader0 open Market Long(3)
            // -S6: Trader1 open Market Short(5)
            await openMarketPosition({
                    quantity: BigNumber.from('300'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader0.address,
                    instanceTrader: trader0,
                    _positionManager: positionManager,
                }
            );

            await openMarketPosition({
                    quantity: BigNumber.from('500'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                }
            );

            // *****************************
            // -S7: Trader2 open Limit Short(5008,7)
            // -S8: Trader3 open Market Long(2)
            let response4 = (await openLimitPositionAndExpect({
                limitPrice: 5008,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 700,
                _trader: trader2
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('200'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader3.address,
                    instanceTrader: trader3,
                    _positionManager: positionManager,

                }
            );

            // *****************************
            // -S9: Trader0 open Market Long(5)
            // -S10: Trader1 open Limit Long(4990,6)
            await openMarketPosition({
                    quantity: BigNumber.from('500'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader0.address,
                    instanceTrader: trader0,
                    _positionManager: positionManager,

                }
            );
            let response5 = (await openLimitPositionAndExpect({
                limitPrice: 4990,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 600,
                _trader: trader1
            })) as unknown as PositionLimitOrderID


            // *****************************
            // -S11: Trader2 open Market Short(4)
            // -S12: Trader3 open Market Short(3)
            await openMarketPosition({
                    quantity: BigNumber.from('400'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );
            await openMarketPosition({
                    quantity: BigNumber.from('300'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader3.address,
                    instanceTrader: trader3,
                    _positionManager: positionManager,
                }
            );


            await changePrice({limitPrice: 4980, toHigherPrice: false})

            const expectTrader0End = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader0.address,
                expectedOpenNotional: 1001600,
                expectedMargin: 100160,
                expectedPnl: -5600,
                expectedQuantity: 200,
            })

            const expectTrader1End = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedOpenNotional: 3007001,
                expectedMargin: 300701,
                expectedPnl: 19001,
                expectedQuantity: -600,
            })

            const expectTrader2End = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader2.address,
                expectedOpenNotional: 499000,
                expectedMargin: 49900,
                expectedPnl: 1000,
                expectedQuantity: -100,
            })

            const expectTrader3End = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader3.address,
                expectedOpenNotional: 2501000,
                expectedMargin: 250100,
                expectedPnl: -11000,
                expectedQuantity: 500,
            })

        })


        /**
         * PS_FUTU_28
         -S1: Trader0 open Limit Long(4995,7)
         -S2: Trader1 open Limit Short(5010,8)
         -S3: Trader2 open Market Long(3)
         -S4: Trader3 open Market Short(6)
         -S5: Trader0 open Limit Long(4990,8)
         -S6: Trader1 open Market Short(5)
         -S7: Trader2 open Market short(4)
         -S8: Trader3 open Limit Long(4980,4)
         -S9: Trader0 open Market Short(3)
         -S10: Trader2 open Market long(4)
         -S11: Trader1 open Market Long(1)
         -S12: Trader0 open Limit Long(4950,2)
         -S13: Trader3 open Market Short(3)

         -S14: Trader(cp0) open Limit Short(5015,6)
         -S15: Trader(cp1) open Market Long(6)
         */
        it('PS_FUTU_28', async () => {
            // *****************************
            //-S1: Trader0 open Limit Long(4995,7)
            // -S2: Trader1 open Limit Short(5010,8)
            let response1 = (await openLimitPositionAndExpect({
                limitPrice: 4995,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 7,
                _trader: trader0
            })) as unknown as PositionLimitOrderID

            let response2 = (await openLimitPositionAndExpect({
                limitPrice: 5010,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 8,
                _trader: trader1
            })) as unknown as PositionLimitOrderID


            // *****************************
            //-S3: Trader2 open Market Long(3)
            //-S4: Trader3 open Market Short(6)
            await openMarketPosition({
                    quantity: BigNumber.from('3'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,

                }
            );

            await openMarketPosition({
                    quantity: BigNumber.from('6'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader3.address,
                    instanceTrader: trader3,
                    _positionManager: positionManager,

                }
            );


            // *****************************
            //-S5: Trader0 open Limit Long(4990,8)
            //-S6: Trader1 open Market Short(5)
            let response3 = (await openLimitPositionAndExpect({
                limitPrice: 4990,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 8,
                _trader: trader0
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('5'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                }
            );


            // *****************************
            // -S7: Trader2 open Market short(4)
            // -S8: Trader3 open Limit Long(4980,4)
            await openMarketPosition({
                    quantity: BigNumber.from('4'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );

            let response4 = (await openLimitPositionAndExpect({
                limitPrice: 4980,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 4,
                _trader: trader3
            })) as unknown as PositionLimitOrderID


            // *****************************
            // -S9: Trader0 open Market Short(3)
            // -S10: Trader2 open Market long(4)
            await openMarketPosition({
                    quantity: BigNumber.from('3'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader0.address,
                    instanceTrader: trader0,
                    _positionManager: positionManager,
                }
            );


            await openMarketPosition({
                    quantity: BigNumber.from('4'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );


            // -S11: Trader1 open Market Long(1)
            // -S12: Trader0 open Limit Long(4950,2)
            // -S13: Trader3 open Market Short(3)

            await openMarketPosition({
                    quantity: BigNumber.from('1'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                }
            );

            let response5 = (await openLimitPositionAndExpect({
                limitPrice: 4950,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 2,
                _trader: trader0
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('3'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader3.address,
                    instanceTrader: trader3,
                    _positionManager: positionManager,
                }
            );


            await changePrice({limitPrice: 5015, toHigherPrice: true})

            const expectTrader0End = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader0.address,
                expectedOpenNotional: 69809,
                expectedMargin: 6981,
                expectedPnl: 401,
                expectedQuantity: 14,
            })

            const expectTrader1End = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedOpenNotional: 60033,
                expectedMargin: 6003,
                expectedPnl: -147,
                expectedQuantity: -12,
            })

            const expectTrader2End = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader2.address,
                expectedOpenNotional: 15030,
                expectedMargin: 1503,
                expectedPnl: 15,
                expectedQuantity: 3,
            })

            // ERROR because trader3 self-filled
            // const expectTrader3End = await expectMarginPnlAndOP({
            //     positionManagerAddress: positionManager.address,
            //     traderAddress: trader3.address,
            //     expectedOpenNotional: 19890 / 4 * 5,
            //     expectedMargin: 1989,
            //     expectedPnl: -170,
            //     expectedQuantity: -5,
            // })
        })

    })

    describe('Limit reverse market', async () => {

        /**
         PS_FUTU_29
         - S1: Trader1 open limit LONG (4990,5)
         - S2: Trader0 open MARKET SHORT (5)
         - S3: Trader2 open limit SHORT  (5010, 1)
         - S4: Trader3 open market LONG (1)
         - S5: Trader0 open limit LONG (5005,2)
         - S6: Trader1 open reverse MARKET position SHORT( 2)

         - S5: Tradercp open Limit LONG(5000,2)
         - S6: Tradercp open MARKET SHORT(2)

         */
        it('PS_FUTU_29', async () => {
            // *****************************
            //- S1: Trader1 open limit LONG (4990,5)
            //- S2: Trader0 open MARKET SHORT (5)
            let response1 = (await openLimitPositionAndExpect({
                limitPrice: 4990,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 500,
                _trader: trader1
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('500'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader0.address,
                    instanceTrader: trader0,
                    _positionManager: positionManager,
                }
            );


            // *****************************
            //- S3: Trader2 open limit SHORT  (5010, 1)
            //- S4: Trader3 open market LONG (1)
            let response2 = (await openLimitPositionAndExpect({
                limitPrice: 5010,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 100,
                _trader: trader2
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('100'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader3.address,
                    instanceTrader: trader3,
                    _positionManager: positionManager,
                }
            );


            // *****************************
            // - S5: Trader0 open limit LONG (5005,2)
            // - S6: Trader1 open reverse MARKET position SHORT( 2)
            let response3 = (await openLimitPositionAndExpect({
                limitPrice: 5005,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 200,
                _trader: trader0
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('200'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                }
            );

            await changePrice({limitPrice: 5000, toHigherPrice: false})

            const expectTrader0End = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader0.address,
                expectedOpenNotional: 1497000,
                expectedMargin: 149700,
                expectedPnl: -3000,
                expectedQuantity: -300
            });

            const expectTrader1End = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedOpenNotional: 1497000,
                expectedMargin: 149700,
                expectedPnl: 3000,
                expectedQuantity: 300
            });
        })

    })

    describe('Open reverse and partial self filled', async function () {
        /**
         * PS_FUTU_102
         -S1: Trader0 open Limit Long(4990,10)
         -S2: Trader1 open Limit Long(4950,5)
         -S3: Trader2 open Market Short(12)
         -S4: Trader0 open Limit LONG(4900,5)
         -S5: Trader1 open Market Short(8)
         -S6: Price change to 4900
         */
        it('PS_FUTU_102: increase limit position quantity', async function () {
            let response1Trader0 = (await openLimitPositionAndExpect({
                limitPrice: 4990,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 1000,
                _trader: trader0
            })) as unknown as PositionLimitOrderID

            let response1Trader1 = (await openLimitPositionAndExpect({
                limitPrice: 4950,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 500,
                _trader: trader1
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('1200'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,

                }
            );

            let response2Trader0 = (await openLimitPositionAndExpect({
                limitPrice: 4900,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 500,
                _trader: trader0
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('800'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,

                }
            );

            const expectTrader0 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader0.address,
                expectedOpenNotional: 7440000,
                expectedMargin: 744000,
                expectedPnl: -90000,
                expectedQuantity: 1500
            });

            const expectTrader2 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader2.address,
                expectedOpenNotional: 5980000,
                expectedMargin: 598000,
                expectedPnl: 100000
            });

            // ERROR expected wrong quantity and ON because of self filled
            // const expectTrader1 = await expectMarginPnlAndOP({
            //     positionManagerAddress: positionManager.address,
            //     traderAddress: trader1.address,
            //     expectedOpenNotional: 490000,
            //     expectedMargin: 49000,
            //     expectedPnl: 5000
            // });
        })

        /**
         * PS_FUTU_106
         S1: Trader0 open limit order Long (4950, 5)
         S2: Trader1 open limit order Long (4980,3)
         S3: Trader2 open market order Short (6)
         S4: Trader0 open limit order Long (4900,5)
         S5: Trader1 open market order Short (5)
         S6: Trader2 open limit order Short(4910,1)
         S7: Trader1 open market order Long (1)
         S8: Current price 4910
         */
        it('PS_FUTU_106: reverse limit position quantity', async function () {
            /**
             S1: Trader0 open limit order Long (4950, 5)
             S2: Trader1 open limit order Long (4980,3)
             S3: Trader2 open market order Short (6) => fulfill S2, partial fill S1
             */
            let response1Trader0 = (await openLimitPositionAndExpect({
                limitPrice: 4950,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 500,
                _trader: trader0
            })) as unknown as PositionLimitOrderID

            let response1Trader1 = (await openLimitPositionAndExpect({
                limitPrice: 4980,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 300,
                _trader: trader1
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('600'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,

                }
            );

            let response2Trader0 = (await openLimitPositionAndExpect({
                limitPrice: 4900,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 500,
                _trader: trader0
            })) as unknown as PositionLimitOrderID


            await openMarketPosition({
                    quantity: BigNumber.from('500'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,

                }
            );

            let response2Trader2 = (await openLimitPositionAndExpect({
                limitPrice: 4910,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 100,
                _trader: trader2
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('100'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,

                }
            );

            const expectTrader0 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader0.address,
                expectedOpenNotional: 3945000,
                expectedMargin: 394500,
                expectedPnl: -17000
            });

            const expectTrader1 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedOpenNotional: 490000,
                expectedMargin: 49000,
                expectedPnl: -1000
            });

            const expectTrader2 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader2.address,
                expectedOpenNotional: 3470000,
                expectedMargin: 347000,
                expectedPnl: 33000
            });
        })

        /**
         * PS_FUTU_107
         S1: Trader0 open limit order Long (4950, 5)
         S2: Trader1 open market order Short (5)
         S3: Trader2 open limit order Long (4900,10)
         S4: Trader1 open 2 limit order Long (4940,3), (4890,5)
         S5: Trader2 open market order Short (8)
         S6: Trader1 open market order Short (10)
         S7: Current price 4890
         */
        it('PS_FUTU_107: reverse by different order type, self filled', async function () {

            // S1: Trader0 open limit order Long (4950, 5)
            // S2: Trader1 open market order Short (5)
            let response1Trader0 = (await openLimitPositionAndExpect({
                limitPrice: 4950,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 500,
                _trader: trader0
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('500'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('-5')
                }
            );

            // S3: Trader2 open limit order Long (4900,10)
            // S4: Trader1 open 2 limit order Long (4940,3), (4890,5)
            let response1Trader2 = (await openLimitPositionAndExpect({
                limitPrice: 4900,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 1000,
                _trader: trader2
            })) as unknown as PositionLimitOrderID

            let response1Trader1 = (await openLimitPositionAndExpect({
                limitPrice: 4940,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 300,
                _trader: trader1
            })) as unknown as PositionLimitOrderID

            let response2Trader1 = (await openLimitPositionAndExpect({
                limitPrice: 4890,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 500,
                _trader: trader1
            })) as unknown as PositionLimitOrderID

            // S5: Trader2 open market order Short (8)
            // S6: Trader1 open market order Short (10)
            await openMarketPosition({
                    quantity: BigNumber.from('800'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,

                }
            );

            await openMarketPosition({
                    quantity: BigNumber.from('1000'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,

                }
            );

            const expectTrader0 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader0.address,
                expectedOpenNotional: 2475000,
                expectedMargin: 247500,
                expectedPnl: -30000
            });

            // ERROR expected wrong quantity and ON because of self filled
            // const expectTrader1 = await expectMarginPnlAndOP({
            //     positionManagerAddress: positionManager.address,
            //     traderAddress: trader1.address,
            //     expectedOpenNotional: 3440000,
            //     expectedMargin: 344000,
            //     expectedPnl: 17000
            // });

            // const expectTrader2 = await expectMarginPnlAndOP({
            //     positionManagerAddress: positionManager.address,
            //     traderAddress: trader2.address,
            //     expectedOpenNotional: 980000,
            //     expectedMargin: 98000,
            //     expectedPnl: -2000
            // });
        })

    })

    describe('Increase size and reverse twice', async function () {

        /**
         * PS_FUTU_109
         S1: Trader0 open limit long (4900,10)
         S2: Trader1 open market short (8)
         S3: Trader2 open limit long (4890,5)
         S4: Trader1 open market short (5)
         S5: Trader0 open limit short (5000,20)
         S6: Trader1 open market long (20)
         S7: Trader2 open limit long (4950,5)
         S8: Trader1 open limit long (4980,20)
         S9: Trader0 open market short (22)
         S10: Trader1 open limit short (5100,10)
         S11: Trader2 open market long (10)
         S12: Current price is 5100
         */
        it('PS_FUTU_109', async function () {

            // S1: Trader0 open limit long (4900,10)
            // S2: Trader1 open market short (8)
            let response1Trader0 = (await openLimitPositionAndExpect({
                limitPrice: 4900,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 1000,
                _trader: trader0
            })) as unknown as PositionLimitOrderID
            console.log("done S1")

            await openMarketPosition({
                    quantity: BigNumber.from('800'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                }
            );
            console.log("done S2")

            // S3: Trader2 open limit long (4890,5)
            // S4: Trader1 open market short (5)
            let response1Trader2 = (await openLimitPositionAndExpect({
                limitPrice: 4890,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 500,
                _trader: trader2
            })) as unknown as PositionLimitOrderID
            console.log("done S3")

            await openMarketPosition({
                    quantity: BigNumber.from('500'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                }
            );
            console.log("done S4")

            const expectTrader1AfterS4 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedOpenNotional: 6367000,
                expectedMargin: 636700,
                expectedPnl: 10000,
                expectedQuantity: -1300,
            });

            // S5: Trader0 open limit short (5000,20)
            // S6: Trader1 open market long (20)
            let response2Trader0 = (await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 2000,
                _trader: trader0
            })) as unknown as PositionLimitOrderID
            console.log("done S5")

            await openMarketPosition({
                    quantity: BigNumber.from('2000'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                }
            );
            console.log("done S6")

            // ERROR wrong Pnl, ON and margin because of wrong entryPrice when getReduceLimitOrder
            // const expectTrader0AfterS6 = await expectMarginPnlAndOP({
            //     positionManagerAddress: positionManager.address,
            //     traderAddress: trader0.address,
            //     expectedOpenNotional: 50000,
            //     expectedMargin: 5000,
            //     expectedPnl: 0,
            //     expectedQuantity: -10,
            // });

            const expectTrader1AfterS6 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedOpenNotional: 3500000,
                expectedMargin: 350000,
                expectedPnl: 0,
                expectedQuantity: 700,
            });

            // S7: Trader2 open limit long (4950,5)
            // S8: Trader1 open limit long (4980,20)
            let response2Trader2 = (await openLimitPositionAndExpect({
                limitPrice: 4950,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 500,
                _trader: trader2
            })) as unknown as PositionLimitOrderID
            console.log("done S7")

            let response1Trader1 = (await openLimitPositionAndExpect({
                limitPrice: 4980,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 2000,
                _trader: trader1
            })) as unknown as PositionLimitOrderID
            console.log("done S8")

            // S9: Trader0 open market short (22)
            // S10: Trader1 open limit short (5100,10)
            // S11: Trader2 open market long (10)
            await openMarketPosition({
                    quantity: BigNumber.from('2200'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader0.address,
                    instanceTrader: trader0,
                    _positionManager: positionManager,
                }
            );
            console.log("done S9")

            // ERROR wrong Pnl, ON and margin because of wrong entryPrice when getReduceLimitOrder
            const expectTrader0AfterS9 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader0.address,
                expectedOpenNotional: 15950000,
                expectedMargin: 1595000,
                expectedPnl: 110000,
                expectedQuantity: -3200,
            });

            // CORRECT
            const expectTrader1AfterS9 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedOpenNotional: 13460000,
                expectedMargin: 1346000,
                expectedPnl: -95000,
                expectedQuantity: 2700,
            });

            let response2Trader1 = (await openLimitPositionAndExpect({
                limitPrice: 5100,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 1000,
                _trader: trader1
            })) as unknown as PositionLimitOrderID
            console.log("done S10")

            await openMarketPosition({
                    quantity: BigNumber.from('1000'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );
            console.log("done S11")

            // ERROR expected ON, margin and Pnl are decimals but underflow
            const expectTrader1AfterS11 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedOpenNotional: 8474800,
                expectedMargin: 847400,
                expectedPnl: 195100,
                expectedQuantity: 1700,
            });

            const expectTrader2AfterS11 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader2.address,
                expectedOpenNotional: 7557000,
                expectedMargin: 755700,
                expectedPnl: 93000,
                expectedQuantity: 1500,
            });
        })
    })

    // describe('Calc market twap', async function () {
    //
    //     /**
    //      * PS_FUTU_200
    //      S1: Current price 5000
    //      S2: Price change to 5100
    //      S3: Price change to 5200 after 5s
    //      S4: Price change to 4800 after 5s
    //      S5: Calc twap market price with interval = 100s
    //      */
    //     it('PS_FUTU_200: Calc market twap', async function () {
    //         console.log("time after s0", Date.now())
    //         await changePrice({
    //             limitPrice: 5100,
    //             toHigherPrice: true,
    //         })
    //
    //         await changePrice({
    //             limitPrice: 5200,
    //             toHigherPrice: true,
    //         })
    //
    //         await changePrice({
    //             limitPrice: 4800,
    //             toHigherPrice: false,
    //         })
    //
    //         await changePrice({
    //             limitPrice: 4900,
    //             toHigherPrice: true,
    //         })
    //
    //         await changePrice({
    //             limitPrice: 4950,
    //             toHigherPrice: true,
    //         })
    //
    //         await changePrice({
    //             limitPrice: 5000,
    //             toHigherPrice: true,
    //         })
    //
    //         await changePrice({
    //             limitPrice: 4900,
    //             toHigherPrice: false,
    //         })
    //
    //         console.log("price feed", (await chainlinkContract.getPrice('0x4254430000000000000000000000000000000000000000000000000000000000')).toString())
    //
    //         const twapMarketPrice = await positionManager.getTwapPrice(13);
    //         console.log(twapMarketPrice)
    //         expect(twapMarketPrice.div(10000)).eq(Math.floor((4800 * 2 + 5200 * 2 + 5100 * 2 + 5000 * 1 + 4900 * 2 + 4950 * 2 + 5000 * 2) / 13))
    //     })
    // })

    // describe('Filled in same price', async function () {
    //
    //     /**
    //      Current price 4000
    //      -S0:Trader0 open Limit short(4900,5)
    //      -S1:Trader1 open Market long(5)
    //      -S2:Trader1 open Limit long(4700,6)
    //      -S3:Trader0 open Market short(6)
    //      -S4:Tradercp open Limit Short(5015,7)
    //      -S5:Tradercp open Market Long(7) => current price 5015
    //
    //      -S6:Trader2 open Limit Long (5015, 2)
    //      -S7:Trader0 open Limit Short (5015, 3)
    //      -S8: Trade3 open Limit Long(5015,1)
    //
    //      -S8:Tradercp open Limit Short(5020,7)
    //      -S9:Tradercp open Market Long(7) => current price 5020
    //
    //      -S10:Trader2 open Limit short(5020,3)
    //      -S11:Trader1 open Limit long(5020,4)
    //      -S12: Trader3 open Limit Short(1)
    //      -S12:Tradercp open Limit Short(5025,4)
    //      -S13:Tradercp open Market Long(4) => current price 5025
    //      */
    //     it('PS_FUTU_30', async function () {
    //
    //         await changePrice({limitPrice: 4000, toHigherPrice: false});
    //
    //         let response2Trader0 = (await openLimitPositionAndExpect({
    //             limitPrice: 4900,
    //             side: SIDE.SHORT,
    //             leverage: 10,
    //             quantity: 500,
    //             _trader: trader0
    //         })) as unknown as PositionLimitOrderID
    //
    //         await openMarketPosition({
    //                 quantity: BigNumber.from('500'),
    //                 leverage: 10,
    //                 side: SIDE.LONG,
    //                 trader: trader1.address,
    //                 instanceTrader: trader1,
    //                 _positionManager: positionManager,
    //
    //             }
    //         );
    //
    //         let response2Trader1 = (await openLimitPositionAndExpect({
    //             limitPrice: 4700,
    //             side: SIDE.LONG,
    //             leverage: 10,
    //             quantity: 600,
    //             _trader: trader1
    //         })) as unknown as PositionLimitOrderID
    //
    //         await openMarketPosition({
    //                 quantity: BigNumber.from('600'),
    //                 leverage: 10,
    //                 side: SIDE.SHORT,
    //                 trader: trader0.address,
    //                 instanceTrader: trader0,
    //                 _positionManager: positionManager,
    //
    //             }
    //         );
    //
    //
    //         await changePrice({limitPrice: 5015, toHigherPrice: true});
    //
    //         let response1Trader2 = (await openLimitPositionAndExpect({
    //             limitPrice: 5015,
    //             side: SIDE.LONG,
    //             leverage: 10,
    //             quantity: 200,
    //             _trader: trader2
    //         })) as unknown as PositionLimitOrderID
    //
    //         let response3Trader0 = (await openLimitPositionAndExpect({
    //             limitPrice: 5015,
    //             side: SIDE.SHORT,
    //             leverage: 10,
    //             quantity: 300,
    //             _trader: trader0
    //         })) as unknown as PositionLimitOrderID
    //
    //         let response1Trader3 = (await openLimitPositionAndExpect({
    //             limitPrice: 5015,
    //             side: SIDE.LONG,
    //             leverage: 10,
    //             quantity: 100,
    //             _trader: trader3
    //         })) as unknown as PositionLimitOrderID
    //
    //         await changePrice({limitPrice: 5020, toHigherPrice: true});
    //
    //         let response2Trader2 = (await openLimitPositionAndExpect({
    //             limitPrice: 5020,
    //             side: SIDE.SHORT,
    //             leverage: 10,
    //             quantity: 300,
    //             _trader: trader2
    //         })) as unknown as PositionLimitOrderID
    //
    //         let response3Trader1 = (await openLimitPositionAndExpect({
    //             limitPrice: 5020,
    //             side: SIDE.LONG,
    //             leverage: 10,
    //             quantity: 400,
    //             _trader: trader1
    //         })) as unknown as PositionLimitOrderID
    //
    //         let response3Trader3 = (await openLimitPositionAndExpect({
    //             limitPrice: 5020,
    //             side: SIDE.SHORT,
    //             leverage: 10,
    //             quantity: 100,
    //             _trader: trader3
    //         })) as unknown as PositionLimitOrderID
    //
    //         await changePrice({limitPrice: 5025, toHigherPrice: true});
    //
    //         const expectTrader0End = await expectMarginPnlAndOP({
    //             positionManagerAddress: positionManager.address,
    //             traderAddress: trader0.address,
    //             expectedOpenNotional: 6774500,
    //             expectedMargin: 677450,
    //             expectedPnl: -260499.9999999998,
    //             expectedQuantity: 0,
    //         })
    //
    //         const expectTrader1End = await expectMarginPnlAndOP({
    //             positionManagerAddress: positionManager.address,
    //             traderAddress: trader0.address,
    //             expectedOpenNotional: 6776000,
    //             expectedMargin: 677600,
    //             expectedPnl: 259000,
    //             expectedQuantity: 0,
    //         })
    //
    //
    //     });
    //
    //
    //     /**
    //      Current price 4000
    //      -S1:Trader0 open Limit short(4900,5)
    //      -S2: Trader1 open Market long(5)
    //      -S3: Trader1 open Limit long(4700,6)
    //      -S4: Trader0 open Market short(6)
    //      -S5: Tradercp open Limit Short(5015,7)
    //      -S6: Tradercp open Market Long(7) => current price 5015
    //
    //      -S7: Trader2 open Limit Short(5015, 2)
    //      -S8: Trader0 open Limit Long(5015, 4) => have 1
    //
    //      -S9: Tradercp open Limit Short(5020,7)
    //      -S10: Tradercp open Market Long(7) => current price 5020
    //
    //      -S11: Trade3 open Limit Long(5015,1) => filled step 8
    //
    //      -S11: Trade2 open Limit Long(5020,3)
    //      -S12: Trade1 open Limit Short(5020,4)
    //      -S13: Trade3 open Limit Long(5020,1)
    //
    //      -S13: Tradercp open Limit Short(5025,4)
    //      -S14: Tradercp open Market Long(4) => current price 5025
    //      */
    //     it('PS_FUTU_31', async function () {
    //
    //         await changePrice({limitPrice: 4000, toHigherPrice: false});
    //
    //         let response2Trader0 = (await openLimitPositionAndExpect({
    //             limitPrice: 4900,
    //             side: SIDE.SHORT,
    //             leverage: 10,
    //             quantity: 500,
    //             _trader: trader0
    //         })) as unknown as PositionLimitOrderID
    //
    //         await openMarketPosition({
    //                 quantity: BigNumber.from('500'),
    //                 leverage: 10,
    //                 side: SIDE.LONG,
    //                 trader: trader1.address,
    //                 instanceTrader: trader1,
    //                 _positionManager: positionManager,
    //                 expectedSize: BigNumber.from('5')
    //             }
    //         );
    //
    //         let response2Trader1 = (await openLimitPositionAndExpect({
    //             limitPrice: 4700,
    //             side: SIDE.LONG,
    //             leverage: 10,
    //             quantity: 600,
    //             _trader: trader1
    //         })) as unknown as PositionLimitOrderID
    //
    //
    //         await openMarketPosition({
    //                 quantity: BigNumber.from('600'),
    //                 leverage: 10,
    //                 side: SIDE.SHORT,
    //                 trader: trader0.address,
    //                 instanceTrader: trader0,
    //                 _positionManager: positionManager,
    //
    //             }
    //         );
    //
    //
    //         await changePrice({limitPrice: 5015, toHigherPrice: true});
    //
    //
    //         let response2Trader2 = (await openLimitPositionAndExpect({
    //             limitPrice: 5015,
    //             side: SIDE.SHORT,
    //             leverage: 10,
    //             quantity: 200,
    //             _trader: trader2
    //         })) as unknown as PositionLimitOrderID
    //
    //         let response3Trader0 = (await openLimitPositionAndExpect({
    //             limitPrice: 5015,
    //             side: SIDE.LONG,
    //             leverage: 10,
    //             quantity: 400,
    //             _trader: trader0
    //         })) as unknown as PositionLimitOrderID
    //
    //         const expectTrader0End1 = await expectMarginPnlAndOP({
    //             positionManagerAddress: positionManager.address,
    //             traderAddress: trader0.address,
    //             expectedOpenNotional: 4311818,
    //             expectedMargin: 431181,
    //             expectedPnl: -2016.81,
    //             expectedQuantity: 0,
    //         })
    //
    //         await changePrice({limitPrice: 5020, toHigherPrice: true});
    //
    //         let response1Trader3 = (await openLimitPositionAndExpect({
    //             limitPrice: 5015,
    //             side: SIDE.LONG,
    //             leverage: 10,
    //             quantity: 1,
    //             _trader: trader3
    //         })) as unknown as PositionLimitOrderID
    //
    //         const expectTrader0End = await expectMarginPnlAndOP({
    //             positionManagerAddress: positionManager.address,
    //             traderAddress: trader0.address,
    //             expectedOpenNotional: 3832727,
    //             expectedMargin: 383272,
    //             expectedPnl: -179272,
    //             expectedQuantity: 0,
    //         })
    //
    //
    //         let response1Trader2 = (await openLimitPositionAndExpect({
    //             limitPrice: 5020,
    //             side: SIDE.LONG,
    //             leverage: 10,
    //             quantity: 300,
    //             _trader: trader2
    //         })) as unknown as PositionLimitOrderID
    //
    //
    //         let response1Trader1 = (await openLimitPositionAndExpect({
    //             limitPrice: 5020,
    //             side: SIDE.SHORT,
    //             leverage: 10,
    //             quantity: 400,
    //             _trader: trader1
    //         })) as unknown as PositionLimitOrderID
    //
    //
    //         const expectTrader1End = await expectMarginPnlAndOP({
    //             positionManagerAddress: positionManager.address,
    //             traderAddress: trader0.address,
    //             expectedOpenNotional: 3832700,
    //             expectedMargin: 383270,
    //             expectedPnl: 179200,
    //             expectedQuantity: 0,
    //         })
    //
    //
    //         let response2Trader3 = (await openLimitPositionAndExpect({
    //             limitPrice: 5020,
    //             side: SIDE.LONG,
    //             leverage: 10,
    //             quantity: 100,
    //             _trader: trader3
    //         })) as unknown as PositionLimitOrderID
    //
    //
    //         const expectTrader1End1 = await expectMarginPnlAndOP({
    //             positionManagerAddress: positionManager.address,
    //             traderAddress: trader0.address,
    //             expectedOpenNotional: 3353600,
    //             expectedMargin: 335300,
    //             expectedPnl: 156800,
    //             expectedQuantity: 0,
    //         })
    //
    //
    //         await changePrice({limitPrice: 5025, toHigherPrice: true});
    //
    //     })
    //
    //
    //     /***
    //      Current price 4000
    //      -S1:Trader0 open Limit short(4900,5)
    //      -S2: Trader1 open Market long(5)
    //      -S3: Trader1 open Limit long(4700,6)
    //      -S4: Trader0 open Market short(6)
    //      -S5: Tradercp open Limit Short(5015,7)
    //      -S6: Tradercp open Market Long(7) => Current price 5015
    //
    //      -S7: Trader2 open Limit Short(5015, 7)
    //      -S8: Trader0 open Limit Long(5015, 9)
    //      -S9: Trade3 open MARKET SHORT(5015,2)
    //
    //      -S9: Tradercp open Limit Short(5020,7)
    //      -S10: Tradercp open Market Long(7) => Current price 5020
    //
    //      -S11: Trade2 open Limit Long(5020,10)
    //      -S12: Trade1 open Limit Short(5020,11)
    //      -S13: Trade3 open Limit Long(5020,1)
    //      -S13: Tradercp open Limit Short(5025,4)
    //      -S14: Tradercp open Market Long(4) => current price 5025
    //      */
    //     it('PS_FUTU_32', async function () {
    //
    //         await changePrice({limitPrice: 4000, toHigherPrice: false});
    //
    //         let response2Trader0 = (await openLimitPositionAndExpect({
    //             limitPrice: 4900,
    //             side: SIDE.SHORT,
    //             leverage: 10,
    //             quantity: 500,
    //             _trader: trader0
    //         })) as unknown as PositionLimitOrderID
    //
    //         await openMarketPosition({
    //                 quantity: BigNumber.from('500'),
    //                 leverage: 10,
    //                 side: SIDE.LONG,
    //                 trader: trader1.address,
    //                 instanceTrader: trader1,
    //                 _positionManager: positionManager,
    //
    //             }
    //         );
    //
    //         let response1Trader1 = (await openLimitPositionAndExpect({
    //             limitPrice: 4700,
    //             side: SIDE.LONG,
    //             leverage: 10,
    //             quantity: 600,
    //             _trader: trader1
    //         })) as unknown as PositionLimitOrderID
    //
    //
    //         await openMarketPosition({
    //                 quantity: BigNumber.from('600'),
    //                 leverage: 10,
    //                 side: SIDE.SHORT,
    //                 trader: trader0.address,
    //                 instanceTrader: trader0,
    //                 _positionManager: positionManager,
    //
    //             }
    //         );
    //
    //         await changePrice({limitPrice: 5015, toHigherPrice: true});
    //
    //         let response1Trader2 = (await openLimitPositionAndExpect({
    //             limitPrice: 5015,
    //             side: SIDE.SHORT,
    //             leverage: 10,
    //             quantity: 700,
    //             _trader: trader2
    //         })) as unknown as PositionLimitOrderID
    //
    //
    //         let response1Trader0 = (await openLimitPositionAndExpect({
    //             limitPrice: 5015,
    //             side: SIDE.LONG,
    //             leverage: 10,
    //             quantity: 900,
    //             _trader: trader0
    //         })) as unknown as PositionLimitOrderID
    //
    //
    //         // TODO confirm expect again with this test
    //         const expectTrader0End1 = await expectMarginPnlAndOP({
    //             positionManagerAddress: positionManager.address,
    //             traderAddress: trader0.address,
    //             expectedOpenNotional: 1916363,
    //             expectedMargin: 191636,
    //             expectedPnl: -112045,
    //             expectedQuantity: 0,
    //         })
    //
    //         await openMarketPosition({
    //                 quantity: BigNumber.from('200'),
    //                 leverage: 10,
    //                 side: SIDE.SHORT,
    //                 trader: trader3.address,
    //                 instanceTrader: trader3,
    //                 _positionManager: positionManager,
    //
    //             }
    //         );
    //
    //
    //         await changePrice({limitPrice: 5020, toHigherPrice: true});
    //
    //
    //         let response2Trader2 = (await openLimitPositionAndExpect({
    //             limitPrice: 5020,
    //             side: SIDE.LONG,
    //             leverage: 10,
    //             quantity: 1000,
    //             _trader: trader2
    //         })) as unknown as PositionLimitOrderID
    //
    //
    //         let response2Trader1 = (await openLimitPositionAndExpect({
    //             limitPrice: 5020,
    //             side: SIDE.SHORT,
    //             leverage: 10,
    //             quantity: 1100,
    //             _trader: trader1
    //         })) as unknown as PositionLimitOrderID
    //
    //         let response2Trader3 = (await openLimitPositionAndExpect({
    //             limitPrice: 5020,
    //             side: SIDE.LONG,
    //             leverage: 10,
    //             quantity: 100,
    //             _trader: trader3
    //         })) as unknown as PositionLimitOrderID
    //
    //
    //         await changePrice({limitPrice: 5020, toHigherPrice: true});
    //
    //     })
    //
    //     it('PS_FUTU_33', async function () {
    //
    //         await changePrice({limitPrice: 4000, toHigherPrice: false});
    //
    //
    //         let response2Trader0 = (await openLimitPositionAndExpect({
    //             limitPrice: 4900,
    //             side: SIDE.SHORT,
    //             leverage: 10,
    //             quantity: 500,
    //             _trader: trader0
    //         })) as unknown as PositionLimitOrderID
    //
    //         await openMarketPosition({
    //                 quantity: BigNumber.from('500'),
    //                 leverage: 10,
    //                 side: SIDE.LONG,
    //                 trader: trader1.address,
    //                 instanceTrader: trader1,
    //                 _positionManager: positionManager,
    //                 expectedSize: BigNumber.from('5')
    //             }
    //         );
    //
    //         let response2Trader1 = (await openLimitPositionAndExpect({
    //             limitPrice: 4700,
    //             side: SIDE.SHORT,
    //             leverage: 10,
    //             quantity: 600,
    //             _trader: trader1
    //         })) as unknown as PositionLimitOrderID
    //
    //         await openMarketPosition({
    //                 quantity: BigNumber.from('600'),
    //                 leverage: 10,
    //                 side: SIDE.SHORT,
    //                 trader: trader0.address,
    //                 instanceTrader: trader0,
    //                 _positionManager: positionManager,
    //             }
    //         );
    //
    //         await changePrice({limitPrice: 5015, toHigherPrice: true});
    //
    //
    //         let response2Trader2 = (await openLimitPositionAndExpect({
    //             limitPrice: 5015,
    //             side: SIDE.SHORT,
    //             leverage: 10,
    //             quantity: 1500,
    //             _trader: trader2
    //         })) as unknown as PositionLimitOrderID
    //
    //         let response1Trader0 = (await openLimitPositionAndExpect({
    //             limitPrice: 5015,
    //             side: SIDE.LONG,
    //             leverage: 10,
    //             quantity: 1500,
    //             _trader: trader0
    //         })) as unknown as PositionLimitOrderID
    //
    //         await changePrice({limitPrice: 5020, toHigherPrice: true});
    //
    //
    //         let response1Trader2 = (await openLimitPositionAndExpect({
    //             limitPrice: 5020,
    //             side: SIDE.LONG,
    //             leverage: 10,
    //             quantity: 1500,
    //             _trader: trader2
    //         })) as unknown as PositionLimitOrderID
    //
    //         await openMarketPosition({
    //                 quantity: BigNumber.from('1500'),
    //                 leverage: 10,
    //                 side: SIDE.SHORT,
    //                 trader: trader1.address,
    //                 instanceTrader: trader1,
    //                 _positionManager: positionManager,
    //             }
    //         );
    //
    //         await changePrice({limitPrice: 5025, toHigherPrice: true});
    //
    //
    //     })
    //
    // });

    describe('Partial liquidate', async function () {


        it('PS_FUTU_38: partial liquidate position and Revert size', async function () {

            /**
             * PS_FUTU_38
             - S0: Trader0 open Limit Long (4900,10)
             - S1: Trader1 open Market Short (10)
             - S2: Trader2 open Limit Long (4425,5)
             - S3: Trader3 open Market Short (5)
             - S4: Call function getMaintenanceDetail of Trader0
             - S5: Trader4 open Limit LONG (4425,2) => LONG
             - S6: Call function liquidate Trader0

             - S7: Tradercp open Limit SHORT (4853,4)
             - S8: Tradercp open Market LONG(4)

             - S9: Call function getMaintenanceDetail of Trader3 (partial liquidate)
             - S10: Trader4 open Limit SHORT (4853,1)
             - S11: Call function liquidate Trader3

             - S12: Trader0 open Limit Short(5375,3)
             - S13: Trader3 open Market long(3)
             - S14: Call function getMaintenanceDetail of Trader1
             - S15: Trader4 open Limit SHORT (5375,2)
             - S16: Call function liquidate Trader1

             - S17: Trader1 open Limit Long (5000,5)
             - S18: Tradercp open Market Short(5)
             - S19: Tradercp open Limit Short(4900,5)
             - S20: Tradercp open Market long(5)
             */

            await changePrice({limitPrice: 5000, toHigherPrice: false});

            //* - S0: Trader0 open Limit Long (4900,10)
            //  - S1: Trader1 open Market Short (10)
            let response0Trader0 = (await openLimitPositionAndExpect({
                limitPrice: 4900,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 100000,
                _trader: trader0
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('100000'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager
                }
            );

            /*   - S2: Trader2 open Limit Long (4425,5)
                 - S3: Trader3 open Market Short (5)*/

            let response0Trader2 = (await openLimitPositionAndExpect({
                limitPrice: 4425,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 50000,
                _trader: trader2
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('50000'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader3.address,
                    instanceTrader: trader3,
                    _positionManager: positionManager
                }
            );

            //  - S4: Call function getMaintenanceDetail of Trader0
            //  - S5: Trader4 open Limit LONG (4425,2) => LONG
            //  - S6: Call function liquidate Trader0
            await getMaintenanceDetailAndExpect({
                positionManagerAddress: positionManager.address,
                traderAddress: trader0.address,
                expectedMarginRatio: 98,
                expectedMaintenanceMargin: 1470000,
                expectedMarginBalance: 1500000
            })
            let response0Trader4 = (await openLimitPositionAndExpect({
                limitPrice: 4425,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 20000,
                _trader: trader4
            })) as unknown as PositionLimitOrderID
            await liquidate(positionManager.address, trader0.address)

            const expectTrader0EndAfterLiquidate = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader0.address,
                expectedOpenNotional: 392000000,
                expectedMargin: 47530000,
                expectedPnl: -38000000,
                expectedQuantity: 80000
            });

            //- S7: Tradercp open Limit SHORT (4853,4)
            //- S8: Tradercp open Market LONG(4)

            await changePrice({limitPrice: 4853, toHigherPrice: true});

            // - S9: Call function getMaintenanceDetail of Trader3 (partial liquidate)
            // - S10: Trader4 open Limit SHORT (4853,1)
            // - S11: Call function liquidate Trader3
            await getMaintenanceDetailAndExpect({
                positionManagerAddress: positionManager.address,
                traderAddress: trader3.address,
                expectedMarginRatio: 91,
                expectedMaintenanceMargin: 663750,
                expectedMarginBalance: 725000
            })
            let response1Trader4 = (await openLimitPositionAndExpect({
                limitPrice: 4853,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 10000,
                _trader: trader4
            })) as unknown as PositionLimitOrderID
            await liquidate(positionManager.address, trader3.address)

            const expectTrader3EndAfterLiquidate = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader3.address,
                expectedOpenNotional: 177000000,
                expectedMargin: 21461250,
                expectedPnl: -17120000,
                expectedQuantity: -40000
            });

            //   - S12: Trader0 open Limit Short(5375,3)
            //   - S13: Trader3 open Market long(3)
            let response2Trader0 = (await openLimitPositionAndExpect({
                limitPrice: 5375,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 30000,
                _trader: trader0
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('30000'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader3.address,
                    instanceTrader: trader3,
                    _positionManager: positionManager
                }
            );

            //  - S14: Call function getMaintenanceDetail of Trader1
            //  - S15: Trader4 open Limit SHORT (5375,2)
            //  - S16: Call function liquidate Trader1
            await getMaintenanceDetailAndExpect({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedMarginRatio: 98,
                expectedMaintenanceMargin: 1470000,
                expectedMarginBalance: 1500000
            })
            let response2Trader4 = (await openLimitPositionAndExpect({
                limitPrice: 5375,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 20000,
                _trader: trader4
            })) as unknown as PositionLimitOrderID
            await liquidate(positionManager.address, trader1.address)

            const expectTrader1EndAfterLiquidate = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedOpenNotional: 392000000,
                expectedMargin: 47530000,
                expectedPnl: -38000000,
                expectedQuantity: -80000
            });

            // - S17: Trader1 open Limit Long (5000,5)
            // - S18: Trader4 open Market Short(5)
            let response0Trader1 = (await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 50000,
                _trader: trader1
            })) as unknown as PositionLimitOrderID
            await openMarketPosition({
                quantity: BigNumber.from('50000'),
                leverage: 10,
                side: SIDE.SHORT,
                trader: trader4.address,
                instanceTrader: trader4,
                _positionManager: positionManager
            });


            // -S19: Tradecp open Limit Long (4900,5)
            // -S20: Tradecp open Market Short(5)
            await changePrice({limitPrice: 4900, toHigherPrice: false});


            //expect in S20
            const expectTrader0End = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader0.address,
                expectedOpenNotional: 245000000,
                expectedMargin: 32830000,
                expectedPnl: 0,
                expectedQuantity: 50000
            });

            const expectTrader1End = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedOpenNotional: 147000000,
                expectedMargin: 17820000,
                expectedPnl: 0,
                expectedQuantity: -30000
            });

            const expectTrader3End = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader3.address,
                expectedOpenNotional: 442500,
                expectedMargin: 53600,
                expectedPnl: -30000,
                expectedQuantity: -10000
            });

        })
        it('PS_FUTU_39: partial liquidate position and  Increase size', async function () {

            /**
             * PS_FUTU_39
             -S0: Trade0 open Limit Long(4900,10)
             -S1: Trade1 open Market Short(10)
             -S2: Trade1 open Limit Short(5000,5)
             -S3: Trade0 open Market Long(5)
             -S4: Trade2 open Limit Long(4509,10)
             -S5: Trade3 open Market Short(10)

             -S6: Call function getMaintenanceDetail of Trader0
             -S7: Trade4 open Limit long (4509,3) => Limit LONG
             -S8: Call function liquidate Trader0

             -S9: Trade2 open Limit short(5411,5)
             -S10: Trade4 open Market long(5)
             -S11: Trade2 open Limit Long(4453,3)
             -S12:Trade3 open Market SHort(3)

             -S13: Call function getMaintenanceDetail of Trader1
             -S14: Trade4 open Limit short(5411,1) => Limit SHORT
             -S15: Call function liquidate Trader1

             -S16: Trade0 open Limit Long(4058,5)
             -S17: Trade1 open Market Short(5)
             -S18: Trade2 open Limit short(4930,5)
             -S19: Trade3 open Market long(5)

             -S20: Call function getMaintenanceDetail of Trader3 (partial liquidate)
             -S21: Trade4 open Limit SHORT (4058,1)
             -S22: Call function liquidate Trader3
             */

                // -S0: Trade0 open Limit Long(4900,10)
                // -S1: Trade1 open Market Short(10)

            let response0Trader0 = (await openLimitPositionAndExpect({
                    limitPrice: 4900,
                    side: SIDE.LONG,
                    leverage: 10,
                    quantity: 100000,
                    _trader: trader0
                })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('100000'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager
                }
            );

            //-S2: Trade1 open Limit Short(5000,5)
            //-S3: Trade0 open Market Long(5)
            let response0Trader1 = (await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: -50000,
                _trader: trader1
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('50000'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader0.address,
                    instanceTrader: trader0,
                    _positionManager: positionManager
                }
            );

            //-S4: Trade2 open Limit Long(4509,10)
            //-S5: Trade3 open Market Short(10)
            let response0Trader2 = (await openLimitPositionAndExpect({
                limitPrice: 4508,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 100000,
                _trader: trader2
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('100000'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader3.address,
                    instanceTrader: trader3,
                    _positionManager: positionManager
                }
            );

            //   -S6: Call function getMaintenanceDetail of Trader0
            //   -S7: Trade4 open Limit long (4509,2) => Limit LONG
            //   -S8: Call function liquidate Trader0

            await getMaintenanceDetailAndExpect({
                positionManagerAddress: positionManager.address,
                traderAddress: trader0.address,
                expectedMarginRatio: 9400,
                expectedMaintenanceMargin: 22465.5,
                expectedMarginBalance: 23850
            })
            let response0Trader4 = (await openLimitPositionAndExpect({
                limitPrice: 4509,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 30000,
                _trader: trader4
            })) as unknown as PositionLimitOrderID
            await liquidate(positionManager.address, trader0.address)
            const expectTrader0EndAfterLiquidate = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader0.address,
                expectedOpenNotional: 5990800,
                expectedMargin: 726384.5,
                expectedPnl: -579999.9999999996,
                expectedQuantity: 120000
            });

            //-S9: TradeCP open Limit short(5411,5)
            //-S10: TradeCP open Market long(5)
            await changePrice({limitPrice: 5411, toHigherPrice: true});

            //-S11: Trade2 open Limit Long(4453,3)
            //-S12:Trade3 open Market SHort(3)
            let response1Trader2 = (await openLimitPositionAndExpect({
                limitPrice: 4453,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 30000,
                _trader: trader2
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('30000'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader3.address,
                    instanceTrader: trader3,
                    _positionManager: positionManager
                }
            );

            // -S13: Call function getMaintenanceDetail of Trader1
            // -S14: Trade4 open Limit short(5411,3) => Limit SHORT
            // -S15: Call function liquidate Trader1
            await getMaintenanceDetailAndExpect({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedMarginRatio: 9400,
                expectedMaintenanceMargin: 22200,
                expectedMarginBalance: 23499.999999999545
            })
            let response2Trader4 = (await openLimitPositionAndExpect({
                limitPrice: 5411,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 30000,
                _trader: trader4
            })) as unknown as PositionLimitOrderID
            await liquidate(positionManager.address, trader1.address)
            const expectTrader1EndAfterLiquidate = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedOpenNotional: 5920000,
                expectedMargin: 717800,
                expectedPnl: -573200.0000000004,
                expectedQuantity: 120000
            });

            //-S15: Trade0 open Limit Long(4058,5)
            //-S16: Trade1 open Market Short(5)

            let response2Trader0 = (await openLimitPositionAndExpect({
                limitPrice: 4058,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 50000,
                _trader: trader0
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('50000'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager
                }
            );


            // -S18: Trade2 open Limit short(4930,5)
            // -S19: Trade3 open Market long(5)
            let response2Trader2 = (await openLimitPositionAndExpect({
                limitPrice: 4930,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 50000,
                _trader: trader2
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('50000'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader3.address,
                    instanceTrader: trader3,
                    _positionManager: positionManager
                }
            );

            //-S20: Call function getMaintenanceDetail of Trader3 (partial liquidate)
            //-S21: Trade4 open Limit SHORT (4058,2.6)
            //-S22: Call function liquidate Trader3
            await getMaintenanceDetailAndExpect({
                positionManagerAddress: positionManager.address,
                traderAddress: trader3.address,
                expectedMarginRatio: 9600,
                expectedMaintenanceMargin: 17528.699999999998,
                expectedMarginBalance: 18190.000000000418
            })
            let response3Trader4 = (await openLimitPositionAndExpect({
                limitPrice: 4058,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 26000,
                _trader: trader4
            })) as unknown as PositionLimitOrderID
            await liquidate(positionManager.address, trader3.address)
            const expectTrader3EndAfterLiquidate = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedOpenNotional: 4674320,
                expectedMargin: 566761.2999999999,
                expectedPnl: -452879.99999999965,
                expectedQuantity: -104000
            });

            //EXPECT
            const expectTrader0End = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader0.address,
                expectedOpenNotional: 8019800,
                expectedMargin: 929284.5000000001,
                expectedPnl: -1121200.0000000007,
                expectedQuantity: 170000
            });

            const expectTrader1End = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedOpenNotional: 7949000,
                expectedMargin: 942900,
                expectedPnl: -1700,
                expectedQuantity: -1121200.0000000007
            });

            const expectTrader3End = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader3.address,
                expectedOpenNotional: 4674320,
                expectedMargin: 566761.2999999999,
                expectedPnl: -452879.99999999965,
                expectedQuantity: -104000
            });


        })
        it('PS_FUTU_40: partial liquidate position and  Increase size AND Revert size', async function () {

            /**
             * PS_FUTU_39
             -S0: Trade0 open Limit Long(4900,10)
             -S1: Trade1 open Market Short(10)
             -S2: Trade0 open Limit Short(5200,5)
             -S3: Trade1 open Market Long(5)
             -S4: Trade2 open Limit Long(4424,5)
             -S5: Trade1 open Market SHort(5)

             -S6: Call function getMaintenanceDetail of Trader0
             -S7: Trade4 open Limit SHORT (4424,1) => Limit LONG
             -S8: Call function liquidate Trader0

             -S9: Trade2 open Limit Short(5113,10)
             -S10: Trade3 open Market Long(10)

             -S11: Call function getMaintenanceDetail of Trader1
             -S12 Trade4 open Limit SHORT (5113,2)
             -S13: Call function liquidate Trader1

             -S14: Trade2 open Limit Long(4618,5)
             -S15: Trade3 open Market Short(5)

             -S16: Call function getMaintenanceDetail of Trader3
             -S17: Trade4 open Limit long(4618,1) => Limit LONG
             -S18: Call function liquidate Trader3

             -S19: TradeCP open Limit Short(5208,4)
             -S20: TradeCP open Market Long(4)

             -S21: Call function getMaintenanceDetail of Trader1
             -S22 Trade4 open Limit short(5208,0.8)
             -S23: Call function liquidate Trader1
             */

                // -S0: Trade0 open Limit Long(4900,10)
                // -S1: Trade1 open Market Short(10)

            let response0Trader0 = (await openLimitPositionAndExpect({
                    limitPrice: 4900,
                    side: SIDE.LONG,
                    leverage: 10,
                    quantity: 100000,
                    _trader: trader0
                })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('100000'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager
                }
            );

            //-S2: Trade1 open Limit Short(5000,5)
            //-S3: Trade0 open Market Long(5)
            let response0Trader1 = (await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 50000,
                _trader: trader1
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('50000'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader0.address,
                    instanceTrader: trader0,
                    _positionManager: positionManager
                }
            );

            //-S4: Trade2 open Limit Long(4424,5)
            //-S5: Trade1 open Market SHort(5)
            let response0Trader2 = (await openLimitPositionAndExpect({
                limitPrice: 4424,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 50000,
                _trader: trader2
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('50000'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager
                }
            );

            //    -S6: Call function getMaintenanceDetail of Trader0
            //    -S7: Trade4 open Limit long (4424,1) => Limit LONG
            //    -S8: Call function liquidate Trader0

            await getMaintenanceDetailAndExpect({
                positionManagerAddress: positionManager.address,
                traderAddress: trader0.address,
                expectedMarginRatio: 9800,
                expectedMaintenanceMargin: 7350,
                expectedMarginBalance: 7500
            })
            let response0Trader4 = (await openLimitPositionAndExpect({
                limitPrice: 4424,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 10000,
                _trader: trader4
            })) as unknown as PositionLimitOrderID
            await liquidate(positionManager.address, trader0.address)
            const expectTrader0EndAfterLiquidate = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader0.address,
                expectedOpenNotional: 1960000,
                expectedMargin: 237650,
                expectedPnl: -190000,
                expectedQuantity: 40000
            });

            // -S9: Trade2 open Limit Short(5113,10)
            //-S10: Trade3 open Market Long(10)
            let response3Trader2 = (await openLimitPositionAndExpect({
                limitPrice: 5113,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 100000,
                _trader: trader2
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('100000'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader3.address,
                    instanceTrader: trader3,
                    _positionManager: positionManager
                }
            );

            // -S11: Call function getMaintenanceDetail of Trader1
            // -S12 Trade4 open Limit SHORT (5113,2)
            // -S13: Call function liquidate Trader1
            await getMaintenanceDetailAndExpect({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedMarginRatio: 9200,
                expectedMaintenanceMargin: 13985.999999999999,
                expectedMarginBalance: 15200
            })
            let response4Trader4 = (await openLimitPositionAndExpect({
                limitPrice: 5113,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 20000,
                _trader: trader4
            })) as unknown as PositionLimitOrderID
            await liquidate(positionManager.address, trader1.address)
            const expectTrader1EndAfterLiquidate1 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedOpenNotional: 3729600,
                expectedMargin: 452214,
                expectedPnl: -360800,
                expectedQuantity: -80000
            });

            // -S14: Trade2 open Limit Long(4618,5)
            // -S15: Trade3 open Market Short(5)
            let response4Trader2 = (await openLimitPositionAndExpect({
                limitPrice: 4618,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 50000,
                _trader: trader2
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('50000'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader3.address,
                    instanceTrader: trader3,
                    _positionManager: positionManager
                }
            );

            //-S16: Call function getMaintenanceDetail of Trader3
            //-S17: Trade4 open Limit long(4618,1) => Limit LONG
            //-S18: Call function liquidate Trader3

            await getMaintenanceDetailAndExpect({
                positionManagerAddress: positionManager.address,
                traderAddress: trader3.address,
                expectedMarginRatio: 9400,
                expectedMaintenanceMargin: 7669.5,
                expectedMarginBalance: 8150
            })
            let response5Trader4 = (await openLimitPositionAndExpect({
                limitPrice: 4618,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 10000,
                _trader: trader4
            })) as unknown as PositionLimitOrderID
            await liquidate(positionManager.address, trader3.address)
            const expectTrader3EndAfterLiquidate = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader3.address,
                expectedOpenNotional: 2045200,
                expectedMargin: 2479805,
                expectedPnl: -198000,
                expectedQuantity: 40000
            });


            // -S19: TradeCP open Limit Short(5208,4)
            // -S20: TradeCP open Market Long(4)
            await changePrice({limitPrice: 5208, toHigherPrice: true});


            //-S21: Call function getMaintenanceDetail of Trader1
            //-S22 Trade4 open Limit short(5208,1.6)
            //-S23: Call function liquidate Trader1
            await getMaintenanceDetailAndExpect({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedMarginRatio: 9000,
                expectedMaintenanceMargin: 13985.999999999999,
                expectedMarginBalance: 15414
            })
            let response3Trader4 = (await openLimitPositionAndExpect({
                limitPrice: 5208,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 16000,
                _trader: trader4
            })) as unknown as PositionLimitOrderID
            await liquidate(positionManager.address, trader1.address)
            const expectTrader1EndAfterLiquidate2 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedOpenNotional: 2983680.0000000003,
                expectedMargin: 438647.58,
                expectedPnl: -349440,
                expectedQuantity: -64000
            });


        })
    })

    describe('debug DTP', async function () {
        it('should got list order pending', async function () {
            let numberOfOrder = 0;
            await openLimitPositionAndExpect({
                limitPrice: 5010,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 35100,
                _trader: trader0
            })
            numberOfOrder++
            await openLimitPositionAndExpect({
                limitPrice: 5199,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 80900,
                _trader: trader0
            })
            numberOfOrder++
            await openLimitPositionAndExpect({
                limitPrice: 5050,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 82600,
                _trader: trader0
            })
            numberOfOrder++
            const listOrderPending = await positionHouse.getListOrderPending(positionManager.address, trader0.address)
            expect(listOrderPending.length).eq(numberOfOrder+1)

        })

        it('get claim amount of position created by limit order and closed by limit order', async function () {
            await openLimitPositionAndExpect({
                limitPrice: 4990,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 10000,
                _trader: trader0
            })

            await openLimitPositionAndExpect({
                limitPrice: 4980,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 10000,
                _trader: trader1
            })

            await openMarketPosition({
                    quantity: BigNumber.from('20000'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );

            await openLimitPositionAndExpect({
                limitPrice: 4980,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 10000,
                _trader: trader0
            })
            await openMarketPosition({
                    quantity: BigNumber.from('10000'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );
            const claimableAmount = await positionHouse.getClaimAmount(positionManager.address, trader0.address)
            expect(claimableAmount).eq(9870000)
        })

        it('get claim amount of position created by market order and closed by limit order', async function () {
            await changePrice({
                limitPrice : 4990,
                toHigherPrice : false
            })

            await openLimitPositionAndExpect({
                limitPrice: 4990,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 10000,
                _trader: trader1
            })

            await openMarketPosition({
                    quantity: BigNumber.from('10000'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader0.address,
                    instanceTrader: trader0,
                    _positionManager: positionManager,
                }
            );

            await openLimitPositionAndExpect({
                limitPrice: 4980,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 10000,
                _trader: trader1
            })

            await openMarketPosition({
                    quantity: BigNumber.from('10000'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );

            await openLimitPositionAndExpect({
                limitPrice: 4980,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 10000,
                _trader: trader0
            })
            await openMarketPosition({
                    quantity: BigNumber.from('10000'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );

            const claimableAmount = await positionHouse.getClaimAmount(positionManager.address, trader0.address)
            expect(claimableAmount).eq(9870000)
        })

        it('get claimable amount correct with limit order and cancelled limit order', async function () {
            await openLimitPositionAndExpect({
                limitPrice: 4990,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 10000,
                _trader: trader0
            })

            await openLimitPositionAndExpect({
                limitPrice: 4980,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 10000,
                _trader: trader1
            })

            await positionHouse.connect(trader0).cancelLimitOrder(positionManager.address, 0, 499000, 1);
            // console.log("cancel success");
            // console.log(await positionHouse.connect(trader0).getPosition(positionManager.address, trader0.address))

            await openLimitPositionAndExpect({
                limitPrice: 4980,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 10000,
                _trader: trader0
            })
            await openMarketPosition({
                    quantity: BigNumber.from('10000'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );
            const claimableAmount = await positionHouse.getClaimAmount(positionManager.address, trader0.address)
            expect(claimableAmount).eq(4980000)
        })

        it('open limit order at current price', async function () {

            await openLimitPositionAndExpect({
                limitPrice: 5010,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 80000,
                _trader: trader2
            })

            await openLimitPositionAndExpect({
                limitPrice: 5020,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 20000,
                _trader: trader1
            })

            await openMarketPosition({
                    quantity: BigNumber.from('100000'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader0.address,
                    instanceTrader: trader0,
                    _positionManager: positionManager,
                }
            );

            await openLimitPositionAndExpect({
                limitPrice: 5020,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 200000,
                _trader: trader1
            })

            console.log((await positionManager.getPrice()).toString())

            await openLimitPositionAndExpect({
                limitPrice: 5020,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 120000,
                _trader: trader0
            })

            // console.log((await positionHouse.getRemovableMargin(positionManager.address, trader0.address)).toString())

            // await positionHouse.connect(trader0).removeMargin(positionManager.address, 500000)

            // await openLimitPositionAndExpect({
            //     limitPrice: 5010,
            //     side: SIDE.SHORT,
            //     leverage: 10,
            //     quantity: 20000,
            //     _trader: trader0
            // })

        })

        it('open limit order, reverse then close and claim', async function () {

            await openLimitPositionAndExpect({
                limitPrice: 4990,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 10,
                _trader: trader0
            })
            console.log("done step 1")
            await openMarketPosition({
                    quantity: BigNumber.from('10'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                }
            );
            console.log("done step 2")
            await openLimitPositionAndExpect({
                limitPrice: 4990,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 20,
                _trader: trader0
            })
            console.log("done step 3")
            await openMarketPosition({
                    quantity: BigNumber.from('20'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                }
            );
            console.log("done step 4")
            await openLimitPositionAndExpect({
                limitPrice: 4980,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 10,
                _trader: trader0
            })
            console.log("done step 5")
            await openMarketPosition({
                    quantity: BigNumber.from('10'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                }
            );
            console.log("done step 6")
            const claimableAmount = await positionHouse.getClaimAmount(positionManager.address, trader0.address)
            expect(claimableAmount).eq(20050)
            console.log("done step 7")
        })

        it('get claim amount of partial filled', async function () {
            await openLimitPositionAndExpect({
                limitPrice: 4990,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 10000,
                _trader: trader0
            })

            await openMarketPosition({
                    quantity: BigNumber.from('2000'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                }
            );

            await openLimitPositionAndExpect({
                limitPrice: 4980,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 20000,
                _trader: trader0
            })
            console.log(4206)

            await positionHouse.cancelLimitOrder(positionManager.address, 1, 498000, 1)
            console.log(4209)

            await openLimitPositionAndExpect({
                limitPrice: 4970,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 20000,
                _trader: trader0
            })
            console.log(4218)

            await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 10000,
                _trader: trader0
            })
            console.log(4227)

            console.log((await positionHouse.getPosition(positionManager.address, trader0.address)).toString())
            const claimableAmount = await positionHouse.getClaimAmount(positionManager.address, trader0.address)
            expect(claimableAmount).eq(19950000)
        })

        it('close order in current price and toggle current price', async function () {
            console.log(4234)
            await openLimitPositionAndExpect({
                limitPrice: 4990,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 10000,
                _trader: trader0
            })
            console.log(4242)

            await openMarketPosition({
                    quantity: BigNumber.from('10000'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                }
            );
            console.log(4253)

            await openLimitPositionAndExpect({
                limitPrice: 4990,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 20000,
                _trader: trader0
            })
            console.log(4262)

            await positionHouse.cancelLimitOrder(positionManager.address, 1, 499000, 2)
            console.log(4265)

            await openLimitPositionAndExpect({
                limitPrice: 4990,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 20000,
                _trader: trader2
            })
            console.log(4274)

            // await openLimitPositionAndExpect({
            //     limitPrice: 5000,
            //     side: SIDE.SHORT,
            //     leverage: 10,
            //     quantity: 10000,
            //     _trader: trader0
            // })
            // console.log(4227)
            //
            // console.log((await positionHouse.getPosition(positionManager.address, trader0.address)).toString())
            // console.log((await positionHouse.getClaimAmount(positionManager.address, trader0.address)).toString())
        })

        it('has market transaction in limit order in current price', async function () {
            console.log(4290)
            await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 10000,
                _trader: trader0
            })
            console.log(4298)

            await openMarketPosition({
                    quantity: BigNumber.from('10000'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                }
            );
            console.log(4309)
            console.log((await positionHouse.getPosition(positionManager.address, trader0.address)).toString())
            console.log((await positionHouse.getPosition(positionManager.address, trader1.address)).toString())

            await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 5000,
                _trader: trader0
            })

            await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 5000,
                _trader: trader1
            })





            console.log(4318)
            const quantityTrader0 = (await positionHouse.getPosition(positionManager.address, trader0.address)).quantity.toString()
            const quantityTrader1 = (await positionHouse.getPosition(positionManager.address, trader1.address)).quantity.toString()
            console.log(await positionHouse.getListOrderPending(positionManager.address, trader1.address))
            console.log("expect trader0")
            expect(quantityTrader0).eq("-5000")
            console.log("expect trader1")
            expect(quantityTrader1).eq("5000")
            // console.log((await positionHouse.getPosition(positionManager.address, trader0.address)).toString())
            // console.log((await positionHouse.getPosition(positionManager.address, trader1.address)).toString())
            // console.log((await positionHouse.getClaimAmount(positionManager.address, trader0.address)).toString())
        })

        it("partial close and got liquidated, transfer claimable amount to trader was liquidated", async function () {
            await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 10000,
                _trader: trader0
            })

            await openMarketPosition({
                    quantity: BigNumber.from('10000'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                }
            );

            await openLimitPositionAndExpect({
                limitPrice: 5010,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 5000,
                _trader: trader0
            })

            await openMarketPosition({
                    quantity: BigNumber.from('5000'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                }
            );

            await changePrice({
                limitPrice : 4000,
                toHigherPrice : false
            })

            await positionHouse.connect(trader1).liquidate(positionManager.address, trader0.address)
        })

        it("cancel close position limit order 100% then open new limit order", async function () {
            console.log(4384)
            await openLimitPositionAndExpect({
                limitPrice: 4990,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 10,
                _trader: trader0
            })

            console.log(await positionHouse.getListOrderPending(positionManager.address, trader0.address))

            console.log(4393)
            await openMarketPosition({
                    quantity: BigNumber.from(10),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                }
            );

            console.log(await positionHouse.getListOrderPending(positionManager.address, trader0.address))


            console.log(4404)
            await positionHouse.connect(trader0).closeLimitPosition(positionManager.address, 499000, 10)

            console.log(await positionHouse.getListOrderPending(positionManager.address, trader0.address))

            console.log(4407)
            await positionHouse.connect(trader0).cancelLimitOrder(positionManager.address, 1, 499000, 2)

            console.log(4410)
            await openLimitPositionAndExpect({
                limitPrice: 4980,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 10,
                _trader: trader0
            })
        })

        it("open order with same price and different side", async function () {
            await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 10,
                _trader: trader0
            })

            await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 10,
                _trader: trader1
            })

            const getTrader0Position = await positionHouse.getPosition(positionManager.address, trader0.address)
            console.log(getTrader0Position)
            expect(getTrader0Position.quantity).eq(-10)

            const getTrader1Position = await positionHouse.getPosition(positionManager.address, trader1.address)
            console.log(getTrader1Position)
            expect(getTrader1Position.quantity).eq(10)
        })
    })
})
