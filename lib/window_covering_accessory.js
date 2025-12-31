const BaseAccessory = require('./base_accessory')

let Accessory;
let Service;
let Characteristic;

class WindowCoveringAccessory extends BaseAccessory {

    constructor(platform, homebridgeAccessory, deviceConfig) {
        ({ Accessory, Characteristic, Service } = platform.api.hap);
        super(
            platform,
            homebridgeAccessory,
            deviceConfig,
            Accessory.Categories.WINDOW_COVERING,
            Service.WindowCovering
        );
        this.statusArr = deviceConfig.status;
        this.hasPercentControlDPCode = this._isHaveDPCodeOfPercentControl();
	if (this.hasPercentControlDPCode) {         // control_back would be better DP to test for
            this.reversePositionValue = true;
        } else {
            this.reversePositionValue = false;
        }

        this.refreshAccessoryServiceIfNeed(this.statusArr, false);
    };

    /**
     * init Or refresh AccessoryService
     */
    refreshAccessoryServiceIfNeed(stateArr, isRefresh) {
        let receivedControlCode = false;
        this.isRefresh = isRefresh;
        for (const statusMap of stateArr) {

            this.log.debug("statusmap = %o", statusMap);

            //Check whether 100% is fully on or fully off. If there is no dp point, 100% is fully off by default
            if (statusMap.code === 'situation_set' && statusMap.value === 'fully_open') {
                this.reversePositionValue = true;
            }

            // Characteristic.TargetPosition based on control or percent_control code
            if (statusMap.code === 'control') {
                receivedControlCode = true;
                this.percentControlMap = statusMap;

                // convert control to percent_control message
                this.percentControlMap.code = 'percent_control';
                if (statusMap.value === 'open') {
                    this.percentControlMap.value = 100;
                } else if (statusMap.value === 'close') {
                    this.percentControlMap.value = 0;
                } else {
                    this.percentControlMap.value = 50;
                }

                this.normalAsync(Characteristic.TargetPosition, this.percentControlMap.value);

                if (!this._isHaveDPCodeOfPercentState()) {
                    // Characteristic.CurrentPosition
                    this.normalAsync(Characteristic.CurrentPosition, this.percentControlMap.value);
                }
            }

            if (!receivedControlCode && statusMap.code === 'percent_control') {
                this.percentControlMap = statusMap
                this.percentControlMap.value = this._getCorrectPercent(this.percentControlMap.value);
                this.normalAsync(Characteristic.TargetPosition, this.percentControlMap.value);

                if (!this._isHaveDPCodeOfPercentState()) {
                    // Characteristic.CurrentPosition
                    this.normalAsync(Characteristic.CurrentPosition, this.percentControlMap.value);
                }

            }

            if (statusMap.code === 'position') {
                this.percentControlMap = statusMap
                const percent = this._getCorrectPercent(parseInt(this.percentControlMap.value))
                this.normalAsync(Characteristic.TargetPosition, percent);

                if (!this._isHaveDPCodeOfPercentState()) {
                    // Characteristic.CurrentPosition
                    this.normalAsync(Characteristic.CurrentPosition, percent);
                }
            }

            if (statusMap.code === 'percent_state') {
                // Characteristic.CurrentPosition
                this.positionMap = statusMap
                this.positionMap.value = this._getCorrectPercent(this.positionMap.value);
                // fudge as curtains dont fully open/close
                if (this.positionMap.value < 10) {
                    this.positionMap.value = 0;
                } else if (this.positionMap.value > 90) {
                    this.positionMap.value = 100;
                }
                this.normalAsync(Characteristic.CurrentPosition, this.positionMap.value);

                // Characteristic.PositionState
                let hbValue = Characteristic.PositionState.STOPPED;
                this.log.debug("compare control %d and status %d", this.percentControlMap.value, this.positionMap.value);
                if (this.percentControlMap.value > this.positionMap.value) {
                    hbValue = Characteristic.PositionState.INCREASING;
                } else if (this.percentControlMap.value < this.positionMap.value) {
                    hbValue = Characteristic.PositionState.DECREASING;
                }
                this.normalAsync(Characteristic.PositionState, hbValue);
            }
        }
    }

    /**
     * add get/set Accessory service Characteristic Listner
     */
    getAccessoryCharacteristic(name, props) {
        //set  Accessory service Characteristic
        this.service.getCharacteristic(name)
            .setProps(props || {})
            .on('get', callback => {
                if (this.hasValidCache()) {
                    callback(null, this.getCachedState(name));
                }
            })
            .on('set', (hbValue, callback) => {
                let percentValue = this._getCorrectPercent(hbValue)
                let tuyaParam = this.getTuyaParam(name, percentValue);
                this.log.info('[SET][%s] set value: %s', this.homebridgeAccessory.displayName, hbValue);
                this.platform.tuyaOpenApi.sendCommand(this.deviceId, tuyaParam).then(() => {
                    //store homebridge value
                    this.setCachedState(name, hbValue);
                    // //store targetPosition value
                    // this.targetPosition = percentValue;
                    callback();
                }).catch((error) => {
                    this.log.error('[SET][%s] Characteristic Error: %s', this.homebridgeAccessory.displayName, error);
                    this.invalidateCache();
                    callback(error);
                });
            });
    }



    /**
     * get Tuya param from HomeBridge param
     */
    getTuyaParam(name, hbParam) {
        let code;
        let value;
        if (Characteristic.TargetPosition === name) {
            code = this.percentControlMap.code;
            value = hbParam;
            if (!this.hasPercentControlDPCode) {
                // if device doesn't support percent_control, convert to control code
                code = 'control';
                if (value == 100) {
                     value = 'open';
                } else if (value == 0) {
                     value = 'close';
                } else {
                     value = 'stop';
                }
            }
            if (code === 'position' && !Number.isFinite(value)) {
                value = "" + hbParam;
            }
        }
        return {
            "commands": [
                {
                    "code": code,
                    "value": value
                }
            ]
        };
    }

    /**
     * get HomeBridge param from tuya param
     */
    // getHomeBridgeParam(name, tuyaParam) {
    //     if (Characteristic.PositionState === name) {
    //         if (this.targetPosition) {
    //             if (this.targetPosition > tuyaParam) {
    //                 return Characteristic.PositionState.INCREASING;
    //             } else if (this.targetPosition < tuyaParam) {
    //                 return Characteristic.PositionState.DECREASING;
    //             } else {
    //                 return Characteristic.PositionState.STOPPED;
    //             }
    //         } else {
    //             return Characteristic.PositionState.STOPPED;
    //         }
    //     }
    // }

    /**
     * update HomeBridge state
     * @param {*} name HomeBridge Name
     * @param {*} hbValue HomeBridge Value
     */
    normalAsync(name, hbValue, props) {
        //store homebridge value
        this.setCachedState(name, hbValue);
        if (this.isRefresh) {
            this.service
                .getCharacteristic(name)
                .updateValue(hbValue);
        } else {
            this.getAccessoryCharacteristic(name, props);
        }
    }

    _getCorrectPercent(value) {
        var percent = value;
        if (this.reversePositionValue) {
            percent = 100 - percent;
        }
	this.log.debug("position value %d => %d", value, percent);
        return percent;
    }


    //Check whether the device supports percent_state dp code
    _isHaveDPCodeOfPercentState() {
        const percentStateDic = this.statusArr.find((item, index) => { return item.code.indexOf("percent_state") != -1 });
        if (percentStateDic) {
            return true;
        } else {
            return false;
        }
    }

    //Check whether the device supports percent_control dp code
    _isHaveDPCodeOfPercentControl() {
        const percentControlDic = this.statusArr.find((item, index) => { return item.code.indexOf("percent_control") != -1 });
        if (percentControlDic) {
            return true;
        } else {
            return false;
        }
    }


    //Check Motor Reversed
    // _isMotorReversed() {
    //     let isMotorReversed
    //     for (const statusMap of this.statusArr) {
    //         switch (statusMap.code) {
    //             case 'control_back_mode':
    //                 if (statusMap.value === 'forward') {
    //                     isMotorReversed = false;
    //                 } else {
    //                     isMotorReversed = true;
    //                 }
    //                 break;
    //             case 'opposite':
    //             case 'control_back':
    //                 isMotorReversed = statusMap.value;
    //                 break;
    //             default:
    //                 break;
    //         }
    //     }
    //     return isMotorReversed;
    // }

    /**
     * Tuya MQTT update device status
     */
    updateState(data) {
        this.refreshAccessoryServiceIfNeed(data.status, true);
    }

}

module.exports = WindowCoveringAccessory;
