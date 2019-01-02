// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license.

"use strict";
import { ConnectionString } from "azure-iot-device";
import * as vscode from "vscode";
import { BaseExplorer } from "./baseExplorer";
import { Constants } from "./constants";
import { DeviceItem } from "./Model/DeviceItem";
import { TelemetryClient } from "./telemetryClient";
import { DistributedSettingUpdateType, Utility } from "./utility";
import iothub = require("azure-iothub");
import { SamplingModeItem } from "./Model/SamplingModeItem";
import { DistributedTracingLabelNode } from "./Nodes/DistributedTracingLabelNode";
import { DistributedTracingSettingNode } from "./Nodes/DistributedTracingSettingNode";

export class DeviceExplorer extends BaseExplorer {
    constructor(outputChannel: vscode.OutputChannel) {
        super(outputChannel);
    }

    public async listDevice() {
        let label = "Device";
        let iotHubConnectionString = await Utility.getConnectionString(Constants.IotHubConnectionStringKey, Constants.IotHubConnectionStringTitle);
        if (!iotHubConnectionString) {
            return;
        }

        let registry = iothub.Registry.fromConnectionString(iotHubConnectionString);
        this._outputChannel.show();
        this.outputLine(label, "Querying devices...");
        TelemetryClient.sendEvent(`AZ.${label}.List`);
        registry.list((err, deviceList) => {
            this.outputLine(label, `${deviceList.length} device(s) found`);
            deviceList.forEach((device, index) => {
                this.outputLine(`${label}#${index + 1}`, JSON.stringify(device, null, 2));
            });
        });
    }

    public async getDevice(deviceItem: DeviceItem, iotHubConnectionString?: string, outputChannel: vscode.OutputChannel = this._outputChannel) {
        let label = "Device";
        if (!iotHubConnectionString) {
            iotHubConnectionString = await Utility.getConnectionString(Constants.IotHubConnectionStringKey, Constants.IotHubConnectionStringTitle);
            if (!iotHubConnectionString) {
                return;
            }
        }

        deviceItem = await Utility.getInputDevice(deviceItem, "AZ.Device.Get.Start", false, iotHubConnectionString);
        if (!deviceItem) {
            return;
        }

        let hostName = Utility.getHostName(iotHubConnectionString);
        let registry = iothub.Registry.fromConnectionString(iotHubConnectionString);
        outputChannel.show();
        this.outputLine(label, `Querying device [${deviceItem.deviceId}]...`, outputChannel);
        return new Promise((resolve, reject) => {
            registry.get(deviceItem.deviceId, this.done("Get", label, resolve, reject, hostName, outputChannel, iotHubConnectionString));
        });
    }

    public async createDevice(edgeDevice: boolean = false, iotHubConnectionString?: string, outputChannel: vscode.OutputChannel = this._outputChannel) {
        if (!iotHubConnectionString) {
            iotHubConnectionString = await Utility.getConnectionString(Constants.IotHubConnectionStringKey, Constants.IotHubConnectionStringTitle);
            if (!iotHubConnectionString) {
                return;
            }
        }

        const label: string = edgeDevice ? "Edge Device" : "Device";
        const hostName: string = Utility.getHostName(iotHubConnectionString);
        const registry: iothub.Registry = iothub.Registry.fromConnectionString(iotHubConnectionString);

        const deviceId: string = await this.promptForDeviceId(`Enter ${label} ID to create`);
        if (!deviceId) {
            return;
        }

        const device: any = {
            deviceId,
        };
        if (edgeDevice) {
            device.capabilities = {
                iotEdge: true,
            };
        }

        outputChannel.show();
        this.outputLine(label, `Creating ${label} '${device.deviceId}'`, outputChannel);
        return new Promise((resolve, reject) => {
            registry.create(device, this.done("Create", label, resolve, reject, hostName, outputChannel, iotHubConnectionString));
        });
    }

    public async deleteDevice(deviceItem?: DeviceItem) {
        let label = "Device";
        let iotHubConnectionString = await Utility.getConnectionString(Constants.IotHubConnectionStringKey, Constants.IotHubConnectionStringTitle);
        if (!iotHubConnectionString) {
            return;
        }
        let registry = iothub.Registry.fromConnectionString(iotHubConnectionString);

        deviceItem = await Utility.getInputDevice(deviceItem, "AZ.Device.Delete.Start");
        if (deviceItem && deviceItem.label) {
            return this.deleteDeviceById(deviceItem.label, label, registry);
        }
    }

    public async updateDistributedTracingSetting(node, updateType?: DistributedSettingUpdateType) {
        let iotHubConnectionString = await Utility.getConnectionString(Constants.IotHubConnectionStringKey, Constants.IotHubConnectionStringTitle);
        if (!iotHubConnectionString) {
            return;
        }

        if (!updateType) {
            updateType = DistributedSettingUpdateType.All;
        }

        try {
            let deviceId: string;
            if (!node) {
                let selectedDevice: DeviceItem = await vscode.window.showQuickPick(
                    Utility.getNoneEdgeDeviceList(iotHubConnectionString),
                    { placeHolder: "Select device...", ignoreFocusOut: true },
                );
                deviceId = selectedDevice.deviceId;
            } else {
                deviceId = node.deviceNode.deviceId;
            }

            let registry = iothub.Registry.fromConnectionString(iotHubConnectionString);
            this._outputChannel.show();

            let twin = await Utility.getTwin(registry, deviceId);

            let mode: boolean = undefined;
            let samplingRate: number = undefined;

            if (twin.properties.desired[Utility.DISTRIBUTED_TWIN_NAME]) {
                mode = Utility.parseDesiredSamplingMode(twin);
                samplingRate = Utility.parseDesiredSamplingRate(twin);
            }

            if (updateType === DistributedSettingUpdateType.OnlySamplingRate) {
                mode = undefined;
            }

            if (updateType === DistributedSettingUpdateType.OnlyMode) {
                samplingRate = undefined;
            }

            if (updateType !== DistributedSettingUpdateType.OnlySamplingRate) {
                let selectedItem: SamplingModeItem = await vscode.window.showQuickPick(
                    this.getSamplingModePickupItems(),
                    { placeHolder: "Distributed tracing is currently " + (mode ? "enabled" : "disabled") + ", select whether to enable/disable the distributed tracing...", ignoreFocusOut: true },
                );
                if (!selectedItem) {
                    return;
                }
                mode = selectedItem.distributedTracingEnabled;
            }

            if (updateType !== DistributedSettingUpdateType.OnlyMode) {
                if (mode !== false) {
                    samplingRate = await this.promptForSamplingRate(`Enter sampling rate, within [0, 100]`, samplingRate);

                    if (samplingRate === undefined) {
                        return;
                    }
                }
            }

            await this.updateDistributedTraceTwin(twin, mode, samplingRate, registry);

            this.outputLine(Constants.IoTHubDistributedTracingSettingLabel, `Update distributed tracing setting for device [${deviceId}] successfully!`);
        } catch (err) {
            this.outputLine(Constants.IoTHubDistributedTracingSettingLabel, `Failed to get or update distributed setting: ${err.message}`);
            return;
        }

        if (node instanceof DistributedTracingLabelNode) {
            vscode.commands.executeCommand("azure-iot-toolkit.refresh", node);
        } else if (node instanceof DistributedTracingSettingNode) {
            vscode.commands.executeCommand("azure-iot-toolkit.refresh", node.parent);
        }
    }

    private async updateDistributedTraceTwin(twin: any, enable: boolean, samplingRate: number, registry: iothub.Registry) {

        if (enable === undefined && samplingRate === undefined) {
            return;
        }

        if (!twin.properties.desired[Utility.DISTRIBUTED_TWIN_NAME]) {
            twin.properties.desired[Utility.DISTRIBUTED_TWIN_NAME] = {};
        }

        if (enable !== undefined) {
            twin.properties.desired[Utility.DISTRIBUTED_TWIN_NAME].sampling_mode = enable ? 1 : 0;
        }

        if (samplingRate !== undefined) {
            twin.properties.desired[Utility.DISTRIBUTED_TWIN_NAME].sampling_rate = samplingRate;
        }

        return new Promise((resolve, reject) => {
            registry.updateTwin(twin.deviceId, JSON.stringify(twin), twin.etag, (err) => {
                if (err) {
                    return reject();
                } else {
                    return resolve();
                }
            });
        });
    }

    private getSamplingModePickupItems(): SamplingModeItem[] {
        return [true, false].map((samplingMode) => new SamplingModeItem(samplingMode));
    }

    private async promptForSamplingRate(prompt: string, defaultValue: number): Promise<number> {
        if (defaultValue === undefined || defaultValue > 100 || defaultValue < 0) {
            defaultValue = 100;
        }
        let samplingRate: string = await vscode.window.showInputBox({ prompt, value: defaultValue.toString() , ignoreFocusOut: true});
        if (samplingRate !== undefined) {
            samplingRate = samplingRate.trim();
            if (!samplingRate) {
                vscode.window.showErrorMessage("Sampling rate cannot be empty");
                return undefined;
            }

            const floatValue = parseFloat(samplingRate);
            if (!Number.isInteger(floatValue) || floatValue < 0 || floatValue > 100) {
                vscode.window.showErrorMessage("Sampling rate should be a positive integer within [0, 100]");
                return undefined;
            }
            return floatValue;
        }

        return undefined;
    }

    private async promptForDeviceId(prompt: string): Promise<string> {
        let deviceId: string = await vscode.window.showInputBox({ prompt });
        if (deviceId !== undefined) {
            deviceId = deviceId.trim();
            if (!deviceId) {
                vscode.window.showErrorMessage("Device ID cannot be empty");
            }
        }

        return deviceId;
    }

    private async deleteDeviceById(deviceId: string, label: string, registry: iothub.Registry) {
        this._outputChannel.show();
        this.outputLine(label, `Deleting device '${deviceId}'`);
        return new Promise((resolve, reject) => {
            registry.delete(deviceId, this.done("Delete", label, resolve, reject));
        });
    }

    private done(op: string, label: string, resolve, reject, hostName: string = null, outputChannel: vscode.OutputChannel = this._outputChannel, iotHubConnectionString?: string) {
        return (err, deviceInfo, res) => {
            const eventName = `AZ.${label.replace(/\s/g, ".")}.${op}`;
            if (err) {
                TelemetryClient.sendEvent(eventName, { Result: "Fail" }, iotHubConnectionString);
                this.outputLine(label, `[${op}] error: ${err.toString()}`, outputChannel);
                reject(err);
            }
            if (res) {
                let result = "Fail";
                if (res.statusCode < 300) {
                    result = "Success";
                    if (op === "Create" || op === "Delete") {
                        vscode.commands.executeCommand("azure-iot-toolkit.refresh");
                    }
                }
                TelemetryClient.sendEvent(eventName, { Result: result }, iotHubConnectionString);
                this.outputLine(label, `[${op}][${result}] status: ${res.statusCode} ${res.statusMessage}`, outputChannel);
            }
            if (deviceInfo) {
                if (deviceInfo.authentication.SymmetricKey.primaryKey != null) {
                    deviceInfo.connectionString = ConnectionString.createWithSharedAccessKey(hostName,
                        deviceInfo.deviceId, deviceInfo.authentication.SymmetricKey.primaryKey);
                }
                if (deviceInfo.authentication.x509Thumbprint.primaryThumbprint != null) {
                    deviceInfo.connectionString = ConnectionString.createWithX509Certificate(hostName, deviceInfo.deviceId);
                }
                this.outputLine(label, `[${op}] device info: ${JSON.stringify(deviceInfo, null, 2)}`, outputChannel);
                resolve(deviceInfo);
            }
            resolve();
        };
    }
}
