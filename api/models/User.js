/**
 * User.js
 *
 * @description :: TODO: You might write a short summary of how this model works and what it represents here.
 * @docs        :: http://sailsjs.org/#!documentation/models
 */
var bcrypt = require('bcrypt');

var User = {

  attributes: {

    username: {
      type: 'string',
      unique: true,
      required: true
    },

    firstName: {
      type: 'string',
      required: true
    },

    lastName: {
      type: 'string',
      required: true
    },

    birthday: {
      type: 'datetime',
      required: true
    },

    facebookID: {
      type: 'string'
    },

    photoUrl: {
      type: 'url'
    },

    nickname: {
      type: 'string'
    },

    pubnubId: {
      type: 'string'
    },

    mugs: {
      collection: 'Mug',
      via: 'owner'
    },

    devices: {
      collection: 'Device',
      via: 'user'
    },

    rooms: {
      collection: 'Room',
      via: 'participants'
    }
  },

  beforeCreate: function (user, next) {
    bcrypt.hash(user.username, 10, function (err, hash) {
      user.pubnubId = hash.replace("/", "");
      next();
    });
  }
};

module.exports = User;