/*
Copyright 2018 New Vector Ltd

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
import MatrixDispatcher from '../matrix-dispatcher';
import dis from '../dispatcher';
import {RoomViewStore} from './RoomViewStore';
import GroupStore from './GroupStore';
import {Store} from 'flux/utils';
import MatrixClientPeg from '../MatrixClientPeg';


function matchesRoom(payload, roomStore) {
    if (!roomStore) {
        return false;
    }
    if (payload.room_alias) {
        return payload.room_alias === roomStore.getRoomAlias();
    }
    return payload.room_id === roomStore.getRoomId();
}

/**
 * A class for keeping track of the RoomViewStores of the rooms shown on the screen.
 * Routes the dispatcher actions to the store of currently active room.
 */
class OpenRoomsStore extends Store {
    constructor() {
        super(dis);

        // Initialise state
        this._state = {
            rooms: [],
            currentIndex: null,
            group_id: null,
        };

        this._forwardingEvent = null;
    }

    getRoomStores() {
        return this._state.rooms.map((r) => r.store);
    }

    getCurrentRoomStore() {
        const currentRoom = this._getCurrentRoom();
        if (currentRoom) {
            return currentRoom.store;
        }
    }

    _getCurrentRoom() {
        const index = this._state.currentIndex;
        if (index !== null && index < this._state.rooms.length) {
            return this._state.rooms[index];
        }
    }

    _setState(newState) {
        this._state = Object.assign(this._state, newState);
        this.__emitChange();
    }

    _hasRoom(payload) {
        return this._roomIndex(payload) !== -1;
    }

    _roomIndex(payload) {
        return this._state.rooms.findIndex((r) => matchesRoom(payload, r.store));
    }

    _cleanupRooms() {
        const room = this._state.room;
        this._state.rooms.forEach((room) => {
            room.dispatcher.unregister(room.store.getDispatchToken());
        });
        this._setState({
            rooms: [],
            group_id: null,
            currentIndex: null
        });
    }

    _createRoom() {
        const dispatcher = new MatrixDispatcher();
        this._setState({
            rooms: [{
                store: new RoomViewStore(dispatcher),
                dispatcher,
            }],
            currentIndex: 0,
        });
    }

    _forwardAction(payload) {
        const currentRoom = this._getCurrentRoom();
        if (currentRoom) {
            currentRoom.dispatcher.dispatch(payload, true);
        }
    }

    async _resolveRoomAlias(payload) {
        try {
            const result = await MatrixClientPeg.get()
                .getRoomIdForAlias(payload.room_alias);
            dis.dispatch({
                action: 'view_room',
                room_id: result.room_id,
                event_id: payload.event_id,
                highlighted: payload.highlighted,
                room_alias: payload.room_alias,
                auto_join: payload.auto_join,
                oob_data: payload.oob_data,
            });
        } catch(err) {
            this._forwardAction({
                action: 'view_room_error',
                room_id: null,
                room_alias: payload.room_alias,
                err: err,
            });
        }
    }

    _setCurrentGroupRoom(index) {
        this._setState({currentIndex: index});
    }

    __onDispatch(payload) {
        switch (payload.action) {
            // view_room:
            //      - room_alias:   '#somealias:matrix.org'
            //      - room_id:      '!roomid123:matrix.org'
            //      - event_id:     '$213456782:matrix.org'
            //      - event_offset: 100
            //      - highlighted:  true
            case 'view_room':
                console.log("!!! OpenRoomsStore: view_room", payload);
                if (!payload.room_id && payload.room_alias) {
                    this._resolveRoomAlias(payload);
                }
                const currentStore = this.getCurrentRoomStore();
                if (matchesRoom(payload, currentStore)) {
                    if (this._hasRoom(payload)) {
                        const roomIndex = this._roomIndex(payload);
                        this._setState({currentIndex: roomIndex});
                    } else {
                        this._cleanupRooms();
                    }
                }
                if (!this.getCurrentRoomStore()) {
                    console.log("OpenRoomsStore: _createRoom");
                    this._createRoom();
                }
                console.log("OpenRoomsStore: _forwardAction");
                this._forwardAction(payload);
                if (this._forwardingEvent) {
                    dis.dispatch({
                        action: 'send_event',
                        room_id: payload.room_id,
                        event: this._forwardingEvent,
                    });
                    this._forwardingEvent = null;
                }
                break;
            case 'view_my_groups':
            case 'view_group':
                this._forwardAction(payload);
                this._cleanupRooms();
                break;
            case 'will_join':
            case 'cancel_join':
            case 'join_room':
            case 'join_room_error':
            case 'on_logged_out':
            case 'reply_to_event':
            case 'open_room_settings':
            case 'close_settings':
                this._forwardAction(payload);
                break;
            case 'forward_event':
                this._forwardingEvent = payload.event;
                break;
            case 'view_group_grid':
                if (payload.group_id !== this._state.group_id) {
                    this._cleanupRooms();
                    // TODO: register to GroupStore updates
                    const rooms = GroupStore.getGroupRooms(payload.group_id);
                    const roomStores = rooms.map((room) => {
                        const dispatcher = new MatrixDispatcher();
                        const store = new RoomViewStore(dispatcher);
                        // set room id of store
                        dispatcher.dispatch({
                            action: 'view_room',
                            room_id: room.roomId
                        }, true);
                        return {
                            store,
                            dispatcher,
                        };
                    });
                    this._setState({
                        rooms: roomStores,
                        group_id: payload.group_id,
                    });
                    this._setCurrentGroupRoom(0);
                }
                break;
        }
    }
}

let singletonOpenRoomsStore = null;
if (!singletonOpenRoomsStore) {
    singletonOpenRoomsStore = new OpenRoomsStore();
}
module.exports = singletonOpenRoomsStore;