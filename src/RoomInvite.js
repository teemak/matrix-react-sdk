/*
Copyright 2016 OpenMarket Ltd
Copyright 2017, 2018 New Vector Ltd

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import React from "react";
import MatrixClientPeg from "./MatrixClientPeg";
import MultiInviter from "./utils/MultiInviter";
import Modal from "./Modal";
import { getAddressType } from "./UserAddress";
import createRoom from "./createRoom";
import sdk from "./";
import dis from "./dispatcher";
import DMRoomMap from "./utils/DMRoomMap";
import { _t } from "./languageHandler";

/**
 * Invites multiple addresses to a room
 * Simpler interface to utils/MultiInviter but with
 * no option to cancel.
 *
 * @param {string} roomId The ID of the room to invite to
 * @param {string[]} addrs Array of strings of addresses to invite. May be matrix IDs or 3pids.
 * @returns {Promise} Promise
 */
function inviteMultipleToRoom(roomId, addrs) {
    const inviter = new MultiInviter(roomId);
    return inviter
        .invite(addrs)
        .then(states => Promise.resolve({ states, inviter }));
}

export function showStartChatInviteDialog() {
    const AddressPickerDialog = sdk.getComponent("dialogs.AddressPickerDialog");
    Modal.createTrackedDialog("Start a chat", "", AddressPickerDialog, {
        title: _t("Start a chat"),
        description: _t("Who would you like to communicate with?"),
        placeholder: _t("Email, name or matrix ID"),
        validAddressTypes: ["mx-user-id", "email"],
        button: _t("Start Chat"),
        onFinished: _onStartChatFinished
    });
}
/*
export function showStartChatInviteDialog() {
    const AddressPickerDialog = sdk.getComponent("dialogs.AddressPickerDialog");
    Modal.createTrackedDialog("Start a chat", "", AddressPickerDialog, {
        title: "Send a text",
        //title: _t("Start a chat"),
        description: "Who do you want to send a text to?",
        //description: _t("Who would you like to communicate with?"),
        placeholder: "Phone number, name, or matrix ID",
        //placeholder: _t("Email, name or matrix ID"),
        validAddressTypes: ["mx-user-id", "email"],
        button: "Send Text",
        //button: _t("Start Chat"),
        onFinished: _onStartChatFinished
    });
}
*/
export function showTextMessageDialog() {
    //What is this?
    const AddressPickerDialog = sdk.getComponent("dialogs.AddressPickerDialog");
    Modal.createTrackedDialog("Send a text", "", AddressPickerDialog, {
        title: "Send a text",
        description: "Who do you want to send the text to?",
        placeholder: "@sms_19544141212",
        validAddressTypes: ["mx-user-id", "email"],
        button: "Send text",
        //What is this?
        onFinished: _onStartChatFinished
    });
}

export function showRoomInviteDialog(roomId) {
    const AddressPickerDialog = sdk.getComponent("dialogs.AddressPickerDialog");
    Modal.createTrackedDialog("Chat Invite", "", AddressPickerDialog, {
        title: _t("Invite new room members"),
        description: _t("Who would you like to add to this room?"),
        button: _t("Send Invites"),
        placeholder: _t("Email, name or matrix ID"),
        onFinished: (shouldInvite, addrs) => {
            _onRoomInviteFinished(roomId, shouldInvite, addrs);
        }
    });
}

function _onStartChatFinished(shouldInvite, addrs) {
    if (!shouldInvite) return;

    const addrTexts = addrs.map(addr => addr.address);

    if (_isDmChat(addrTexts)) {
        const rooms = _getDirectMessageRooms(addrTexts[0]);
        if (rooms.length > 0) {
            // A Direct Message room already exists for this user, so select a
            // room from a list that is similar to the one in MemberInfo panel
            const ChatCreateOrReuseDialog = sdk.getComponent(
                "views.dialogs.ChatCreateOrReuseDialog"
            );
            const close = Modal.createTrackedDialog(
                "Create or Reuse",
                "",
                ChatCreateOrReuseDialog,
                {
                    userId: addrTexts[0],
                    onNewDMClick: () => {
                        dis.dispatch({
                            action: "start_chat",
                            user_id: addrTexts[0]
                        });
                        close(true);
                    },
                    onExistingRoomSelected: roomId => {
                        dis.dispatch({
                            action: "view_room",
                            room_id: roomId
                        });
                        close(true);
                    }
                }
            ).close;
        } else {
            // Start a new DM chat
            createRoom({ dmUserId: addrTexts[0] }).catch(err => {
                const ErrorDialog = sdk.getComponent("dialogs.ErrorDialog");
                Modal.createTrackedDialog(
                    "Failed to invite user",
                    "",
                    ErrorDialog,
                    {
                        title: _t("Failed to invite user"),
                        description:
                            err && err.message
                                ? err.message
                                : _t("Operation failed")
                    }
                );
            });
        }
    } else if (addrTexts.length === 1) {
        // Start a new DM chat
        createRoom({ dmUserId: addrTexts[0] }).catch(err => {
            const ErrorDialog = sdk.getComponent("dialogs.ErrorDialog");
            Modal.createTrackedDialog(
                "Failed to invite user",
                "",
                ErrorDialog,
                {
                    title: _t("Failed to invite user"),
                    description:
                        err && err.message
                            ? err.message
                            : _t("Operation failed")
                }
            );
        });
    } else {
        // Start multi user chat
        let room;
        createRoom()
            .then(roomId => {
                room = MatrixClientPeg.get().getRoom(roomId);
                return inviteMultipleToRoom(roomId, addrTexts);
            })
            .then(result => {
                return _showAnyInviteErrors(
                    result.states,
                    room,
                    result.inviter
                );
            })
            .catch(err => {
                console.error(err.stack);
                const ErrorDialog = sdk.getComponent("dialogs.ErrorDialog");
                Modal.createTrackedDialog("Failed to invite", "", ErrorDialog, {
                    title: _t("Failed to invite"),
                    description:
                        err && err.message
                            ? err.message
                            : _t("Operation failed")
                });
            });
    }
}

function _onRoomInviteFinished(roomId, shouldInvite, addrs) {
    if (!shouldInvite) return;

    const addrTexts = addrs.map(addr => addr.address);

    // Invite new users to a room
    inviteMultipleToRoom(roomId, addrTexts)
        .then(result => {
            const room = MatrixClientPeg.get().getRoom(roomId);
            return _showAnyInviteErrors(result.states, room, result.inviter);
        })
        .catch(err => {
            console.error(err.stack);
            const ErrorDialog = sdk.getComponent("dialogs.ErrorDialog");
            Modal.createTrackedDialog("Failed to invite", "", ErrorDialog, {
                title: _t("Failed to invite"),
                description:
                    err && err.message ? err.message : _t("Operation failed")
            });
        });
}

function _isDmChat(addrTexts) {
    if (
        addrTexts.length === 1 &&
        getAddressType(addrTexts[0]) === "mx-user-id"
    ) {
        return true;
    } else {
        return false;
    }
}

function _showAnyInviteErrors(addrs, room, inviter) {
    // Show user any errors
    const failedUsers = Object.keys(addrs).filter(a => addrs[a] === "error");
    if (failedUsers.length === 1 && inviter.fatal) {
        // Just get the first message because there was a fatal problem on the first
        // user. This usually means that no other users were attempted, making it
        // pointless for us to list who failed exactly.
        const ErrorDialog = sdk.getComponent("dialogs.ErrorDialog");
        Modal.createTrackedDialog(
            "Failed to invite users to the room",
            "",
            ErrorDialog,
            {
                title: _t("Failed to invite users to the room:", {
                    roomName: room.name
                }),
                description: inviter.getErrorText(failedUsers[0])
            }
        );
    } else {
        const errorList = [];
        for (const addr of failedUsers) {
            if (addrs[addr] === "error") {
                const reason = inviter.getErrorText(addr);
                errorList.push(addr + ": " + reason);
            }
        }

        if (errorList.length > 0) {
            const ErrorDialog = sdk.getComponent("dialogs.ErrorDialog");
            Modal.createTrackedDialog(
                "Failed to invite the following users to the room",
                "",
                ErrorDialog,
                {
                    title: _t(
                        "Failed to invite the following users to the %(roomName)s room:",
                        { roomName: room.name }
                    ),
                    description: errorList.join(<br />)
                }
            );
        }
    }

    return addrs;
}

function _getDirectMessageRooms(addr) {
    const dmRoomMap = new DMRoomMap(MatrixClientPeg.get());
    const dmRooms = dmRoomMap.getDMRoomsForUserId(addr);
    const rooms = dmRooms.filter(dmRoom => {
        const room = MatrixClientPeg.get().getRoom(dmRoom);
        if (room) {
            return room.getMyMembership() === "join";
        }
    });
    return rooms;
}
