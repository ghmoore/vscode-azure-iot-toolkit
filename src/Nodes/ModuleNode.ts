// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license.

import * as vscode from "vscode";
import { Constants } from "../constants";
import { ModuleItem } from "../Model/ModuleItem";
import { TelemetryClient } from "../telemetryClient";
import { Utility } from "../utility";
import { DeviceNode } from "./DeviceNode";
import { INode } from "./INode";
import { ModuleItemNode } from "./ModuleItemNode";

export class ModuleNode implements INode {
    private readonly label: string;

    constructor(public deviceNode: DeviceNode) {
        this.label = "Modules";
    }

    public getTreeItem(): vscode.TreeItem {
        return {
            label: this.label,
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
            contextValue: "modules-label",
        };
    }

    public async getChildren(context: vscode.ExtensionContext, iotHubConnectionString: string): Promise<INode[]> {
        if (this.deviceNode.deviceItem.contextValue === "edge") {
            TelemetryClient.sendEvent(Constants.IoTHubAILoadEdgeModuleTreeStartEvent);
            try {
                const moduleList: vscode.TreeItem[] = await Utility.getModuleItemsForEdge(iotHubConnectionString, this.deviceNode.deviceItem, context);
                TelemetryClient.sendEvent(Constants.IoTHubAILoadEdgeModuleTreeDoneEvent, { Result: "Success" });

                let moduleNodeList: INode[] = [];
                moduleList.forEach((item) => {
                    moduleNodeList.push(new ModuleItemNode(item as ModuleItem));
                });
                return moduleNodeList;
            } catch (err) {
                TelemetryClient.sendEvent(Constants.IoTHubAILoadEdgeModuleTreeDoneEvent, { Result: "Fail", Message: err.message });
                return Utility.getErrorMessageTreeItems("modules", err.message);
            }
        } else if (this.deviceNode.deviceItem.contextValue === "device") {
            TelemetryClient.sendEvent(Constants.IoTHubAILoadModuleTreeStartEvent);
            try {
                const moduleList: vscode.TreeItem[] = await Utility.getModuleItems(iotHubConnectionString, this.deviceNode.deviceItem, context);
                TelemetryClient.sendEvent(Constants.IoTHubAILoadModuleTreeDoneEvent, { Result: "Success" });
                if (moduleList.length === 0) {
                    moduleList.push(new vscode.TreeItem(`No Modules`));
                }

                let moduleNodeList: INode[] = [];
                moduleList.forEach((item) => {
                    moduleNodeList.push(new ModuleItemNode(item as ModuleItem));
                });
                return moduleNodeList;
            } catch (err) {
                TelemetryClient.sendEvent(Constants.IoTHubAILoadModuleTreeDoneEvent, { Result: "Fail", Message: err.message });
                return Utility.getErrorMessageTreeItems("modules", err.message);
            }
        }
    }
}
