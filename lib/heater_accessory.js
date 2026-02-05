const BaseAccessory = require('./base_accessory')

let Accessory;
let Service;
let Characteristic;
let UUIDGen;

const DEFAULT_LEVEL_COUNT = 3;
class HeaterAccessory extends BaseAccessory {
  constructor(platform, homebridgeAccessory, deviceConfig) {

    ({ Accessory, Characteristic, Service } = platform.api.hap);
    super(
      platform,
      homebridgeAccessory,
      deviceConfig,
      Accessory.Categories.AIR_HEATER,
      Service.HeaterCooler
    );
    this.statusArr = deviceConfig.status;
    this.functionArr = deviceConfig.functions ? deviceConfig.functions : [];

    //get speed level dp range
    this.level_count = this.getLevelFunction("level")
    this.speed_coefficient = 100 / this.level_count

    //get TempSet dp range
    //this.temp_set_range = this.getTempSetDPRange()
    this.displayUnits = 'c'	// default to CELSIUS

    this.refreshAccessoryServiceIfNeed(this.statusArr, false);
  }

  //init Or refresh AccessoryService
  refreshAccessoryServiceIfNeed(statusArr, isRefresh) {
    this.isRefresh = isRefresh;
    for (var statusMap of statusArr) {
      if (statusMap.code === 'switch') {
        this.switchMap = statusMap
        const hbSwitch = this.tuyaParamToHomeBridge(Characteristic.Active, this.switchMap);
        this.normalAsync(Characteristic.Active, hbSwitch)
        this.normalAsync(Characteristic.CurrentHeaterCoolerState, 2)
        this.normalAsync(Characteristic.TargetHeaterCoolerState, 1, {
          minValue: 1,
          maxValue: 1,
          validValues: [Characteristic.TargetHeaterCoolerState.HEAT]
        })
      }
      if (statusMap.code === 'temp_current' && this.displayUnits === 'c') {
        this.temperatureMap = statusMap
        this.normalAsync(Characteristic.CurrentTemperature, this.temperatureMap.value, {
          minValue: 0,
          maxValue: 40,
          minStep: 1
        })
      }
      if (statusMap.code === 'temp_current_f' && this.displayUnits === 'f') {
        this.temperatureMap = statusMap
        this.normalAsync(Characteristic.CurrentTemperature, this.temperatureMap.value, {
          minValue: 32,
          maxValue: 104,
          minStep: 1
        })
      }
      if (statusMap.code === 'temp_unit_convert') {
        const hbUnits = this.tuyaParamToHomeBridge(Characteristic.TemperatureDisplayUnits, this.temperatureMap);
        this.normalAsync(Characteristic.TemperatureDisplayUnits, hbUnits, {
          minValue: 0,
          maxValue: 1,
        })
      }
      if (statusMap.code === 'lock') {
        this.lockMap = statusMap
        const hbLock = this.tuyaParamToHomeBridge(Characteristic.LockPhysicalControls, this.lockMap);
        this.normalAsync(Characteristic.LockPhysicalControls, hbLock)
      }
      if (statusMap.code === 'level') {
        this.speedMap = statusMap;
        const hbSpeed = this.tuyaParamToHomeBridge(Characteristic.RotationSpeed, this.speedMap);
        this.normalAsync(Characteristic.RotationSpeed, hbSpeed)
      }
      if (statusMap.code === 'shake') {
        this.shakeMap = statusMap
        const hbShake = this.tuyaParamToHomeBridge(Characteristic.SwingMode, this.shakeMap);
        this.normalAsync(Characteristic.SwingMode, hbShake)
      }
      if (statusMap.code === 'temp_set' && this.displayUnits === 'c') {
        this.tempsetMap = statusMap
        this.normalAsync(Characteristic.HeatingThresholdTemperature, this.tempsetMap.value, {
          minValue: 0,
          maxValue: 40,
          minStep: 1
        })
      }
      if (statusMap.code === 'temp_set_f' && this.displayUnits === 'f') {
        this.tempsetMap = statusMap
        this.normalAsync(Characteristic.HeatingThresholdTemperature, this.tempsetMap.value, {
          minValue: 32,
          maxValue: 104,
          minStep: 1
        })
      }
    }
  }

  normalAsync(name, hbValue, props) {
    this.setCachedState(name, hbValue);
    if (this.isRefresh) {
      this.service
        .getCharacteristic(name)
        .updateValue(hbValue);
    } else {
      this.getAccessoryCharacteristic(name, props);
    }
  }

  getAccessoryCharacteristic(name, props) {
    //set  Accessory service Characteristic
    this.service.getCharacteristic(name)
      .setProps(props || {})
      .on('get', callback => {
        if (this.hasValidCache()) {
          callback(null, this.getCachedState(name));
        }
      })
      .on('set', (value, callback) => {
        if (name == Characteristic.TargetHeaterCoolerState || name == Characteristic.TemperatureDisplayUnits) {
          callback();
          return;
        }
        var param = this.getSendParam(name, value)
        this.platform.tuyaOpenApi.sendCommand(this.deviceId, param).then(() => {
          this.setCachedState(name, value);
          callback();
        }).catch((error) => {
          this.log.error('[SET][%s] Characteristic.%s Error: %s', this.homebridgeAccessory.displayName, name, error);
          this.invalidateCache();
          callback(error);
        });
      });
  }

  //get Command SendData
  getSendParam(name, value) {
    var code;
    var value;
    switch (name) {
      case Characteristic.Active:
        const isOn = value ? true : false;
        code = "switch";
        value = isOn;
        break;
      case Characteristic.LockPhysicalControls:
        const isLock = value ? true : false;
        code = "lock";
        value = isLock;
        break;
      case Characteristic.RotationSpeed: {
        let level = Math.floor(value / this.speed_coefficient) + 1
        level = level > this.level_count ? this.level_count : level;
        code = this.speedMap.code
        value = "" + level;
      }
        break;
      case Characteristic.SwingMode:
        const isSwing = value ? true : false;
        code = "shake";
        value = isSwing;
        break;
      case Characteristic.HeatingThresholdTemperature:
        const tempset = value;
        code = this.tempsetMap.code;
        value = tempset;
        break;
      default:
        break;
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


  tuyaParamToHomeBridge(name, param) {
    switch (name) {
      case Characteristic.Active:
      case Characteristic.LockPhysicalControls:
      case Characteristic.SwingMode:
        let status
        if (param.value) {
          status = 1
        } else {
          status = 0
        }
        return status
      case Characteristic.TemperatureDisplayUnits:
        let units
        if (param.value === 'f') {
          units = 1
        } else {
          units = 0
        }
        return units
      case Characteristic.RotationSpeed:
        let speed
        speed = parseInt(param.value * this.speed_coefficient);
        return speed
    }
  }

  getLevelFunction(code) {
    if (this.functionArr.length == 0) {
      return DEFAULT_LEVEL_COUNT;
    }
    var funcDic = this.functionArr.find((item, index) => { return item.code == code })
    if (funcDic) {
      let value = JSON.parse(funcDic.values)
      let isnull = (JSON.stringify(value) == "{}")
      return isnull ? DEFAULT_LEVEL_COUNT : value.range.length;
    } else {
      return DEFAULT_LEVEL_COUNT;
    }
  }

  getTempSetDPRange() {
    if (this.functionArr.length == 0) {
      return;
    }
    let tempSetRange
    for (const funcDic of this.functionArr) {
      let valueRange = JSON.parse(funcDic.values)
      let isnull = (JSON.stringify(valueRange) == "{}")

      switch (funcDic.code) {
        case 'temp_set':
          tempSetRange = isnull ? { 'min': 0, 'max': 50 } : { 'min': parseInt(valueRange.min), 'max': parseInt(valueRange.max) }
          break;
        case 'temp_set_f':
          tempSetRange = isnull ? { 'min': 32, 'max': 104 } : { 'min': parseInt(valueRange.min), 'max': parseInt(valueRange.max) }
          break;
        default:
          break;
      }
    }
    return tempSetRange
  }

  //update device status
  updateState(data) {
    this.refreshAccessoryServiceIfNeed(data.status, true);
  }
}

module.exports = HeaterAccessory;
