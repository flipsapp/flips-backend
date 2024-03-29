/**
 * UserController
 *
 * @description :: Server-side logic for managing users
 * @help        :: See http://links.sailsjs.org/docs/controllers
 */
var MAX_RETRY_COUNT = 2;
var actionUtil = requires('>/node_modules/sails/lib/hooks/blueprints/actionUtil');
var Krypto = requires('>/api/utilities/Krypto');

var UserController = {

  uploadPhoto: function (request, response) {
    var userId = request.params.parentid;
    var photo = request.file('photo');

    if (!userId) {
      return response.send(400, new FlipsError('Missing parameter: [User Id]'));
    }

    if (!photo || photo._files.length < 1) {
      return response.send(400, new FlipsError('Missing parameter: [User Photo]'));
    }

    s3service.upload(photo, s3service.PICTURES_BUCKET, function (err, uploadedFiles) {
      if (err) {
        var errmsg = new FlipsError('Error uploading picture', err);
        logger.error(errmsg);
        return response.send(500, errmsg);
      }

      if (!uploadedFiles || uploadedFiles.length < 1) {
        return response.send(400, new FlipsError('Error uploading file'));
      }

      var uploadedFile = uploadedFiles[0];

      User.update(userId, {photoUrl: s3service.S3_URL + s3service.PICTURES_BUCKET + '/' + uploadedFile.fd})
        .exec(function (err, updatedUser) {

          if (err) {
            var errmsg = new FlipsError('Error updating user', err);
            logger.error(errmsg);
            return response.send(500, errmsg);
          }

          if (!updatedUser || updatedUser.length < 1) {
            return response.send(400, new FlipsError('Error updating user with photo url'));
          }

          return response.send(200, Krypto.decryptUser(updatedUser[0]));
        });
    });
  },

  forgot: function (request, response) {
    var phoneNumber = request.param('phone_number');
    var deviceId = request.param('device_id');
    var platform = request.param('platform');
    var token = request.param('device_token');

    if (!phoneNumber) {
      return response.send(400, new FlipsError('Error requesting to reset password.', 'Phone Number is empty.'));
    }
    
    User.findOne({phoneNumber: Krypto.encrypt(phoneNumber)})
      .exec(function (err, user) {
        if (err) {
          var errmsg = new FlipsError('Error retrieving the user.');
          logger.error(errmsg);
          return response.send(500, errmsg);
        }

        if (!user) {
          return response.send(404, new FlipsError('User not found.'));
        }

        if (user.facebookID) {
          return response.send(400, new FlipsError('Error requesting to reset password.', 'This phone number is associated with a Facebook account, so password reset is not required. Please enter a different number, or return to the Login screen to sign in with Facebook.'));
        }

        if (deviceId) {

          Device.findOne({user: user.id, id: deviceId})
            .populate('user')
            .exec(function (error, device) {

              if (error) {
                var errmsg = new FlipsError('Forgot Password Error', 'Server error while trying to retrieve device information.');
                logger.error(errmsg);
                return response.send(500, errmsg);
              }

              if (!device) {
                return response.send(404, new FlipsError('Forgot Password Error', 'This device was not found.'));
              }

              sendVerificationCode(device, phoneNumber);

              return response.json(200, {id: device.id});

            }
          );

        } else {

          Device
            .create({user: user.id, platform: platform, uuid: token})
            .exec(function (error, device) {
              if (error) {
                var errmsg = new FlipsError('Forgot Password Error', 'Server error while trying to create device information.');
                logger.error(errmsg);
                return response.send(500, errmsg);
              }

              if (!device) {
                return response.send(400, new FlipsError('Forgot Password Error', 'Device information could not be created.'));
              }

              sendVerificationCode(device, phoneNumber);

              return response.json(200, {id: device.id});

            });

        }

      }
    );
  },

  resendCodeWhenChangingNumber: function(request, response) {
    var userId = request.params.parentid;
    var deviceId = request.params.id;
    var phoneNumber = request.param('phone_number');

    if (!phoneNumber) {
      return response.send(400, new FlipsError('Error requesting to change phone number.', 'Phone Number is empty.'));
    }

    if (!userId) {
      return response.send(400, new FlipsError('Missing parameter [User Id]'));
    }

    if (!deviceId) {
      return response.send(400, new FlipsError('Missing parameter [Device Id]'));
    }

    Device.findOne(deviceId)
      .exec(function (error, device) {

        if (error) {
          var errmsg = new FlipsError('Error retrieving the device.', error.details);
          return response.send(500, errmsg);
        }

        if (!device) {
          return response.send(404, new FlipsError('Device not found.', 'Device id = ' + deviceId));
        }

        // just ensure that the device is related to user parameter
        if (userId != device.user) {
          return response.send(403, new FlipsError('This device does not belong to you'));
        }

        User.findOne(userId).exec(function (error, user) {

          if (error) {
            return response.send(500, new FlipsError('Error retrieving the user.', error.details));
          }

          if (!user) {
            return response.send(404, new FlipsError('User not found.', 'Device id = ' + deviceId));
          }

          sendVerificationCode(device, phoneNumber);

          return response.send(200, device);

        });

      }
    );

  },

  verify: function (request, response) {
    var phoneNumber = request.param('phone_number');
    var verificationCode = request.param('verification_code');
    var deviceId = request.param('device_id');

    if (!phoneNumber || !verificationCode) {
      return response.send(400, new FlipsError('Error requesting to reset password.', 'Phone Number is missing.'));
    }

    if (!verificationCode) {
      return response.send(400, new FlipsError('Error requesting to reset password.', 'Verification code is missing.'));
    }

    if (!deviceId) {
      return response.send(400, new FlipsError('Error requesting to reset password.', 'Device ID is missing.'));
    }

    User.findOne({phoneNumber: Krypto.encrypt(phoneNumber)}).exec(function (err, user) {
      if (err) {
        return response.send(500, new FlipsError('Error retrieving user'));
      }
      if (!user) {
        return response.send(404, new FlipsError('User not found'));
      }
      Device.findOne({user: user.id, id: deviceId})
        .populate('user')
        .exec(function (error, device) {
          if (error) {
            var errmsg = new FlipsError('Error retrieving device');
            logger.error(errmsg);
            return response.send(500, errmsg);
          }
          if (!device) {
            return response.send(404, new FlipsError('Device not found'));
          }
          if (device.verificationCode != verificationCode) {
            device.retryCount++;
            device.isVerified = false;
            device.save();
            if (device.retryCount > MAX_RETRY_COUNT) {
              sendVerificationCode(device, Krypto.decrypt(device.user.phoneNumber));
              return response.send(400, new FlipsError('3 incorrect entries. Check your messages for a new code.'));
            } else {
              return response.send(400, new FlipsError('Wrong validation code'));
            }
          }

          device.isVerified = true;
          device.retryCount = 0;
          device.save();

          device.user = Krypto.decryptUser(device.user);

          return response.send(200, device);

        }
      );
    });
  },

  findActiveUserByPhoneNumber: function (request, response) {
    var phoneNumber = request.param('phone_number');

    if (!phoneNumber) {
      return response.send(400, new FlipsError('Phone number is empty.'));
    }

    User.findOne({phoneNumber: Krypto.encrypt(phoneNumber), isTemporary: false}).exec(function (err, user) {
      if (err) {
        return response.send(500, new FlipsError('An error occurred while trying to lookup phone number.'));
      }
      if (!user) {
        return response.send(200, {exists: false});
      }
      return response.send(200, {exists: true});
    });
  },


  updatePassword: function (request, response) {
    var email = request.param('email');
    var phoneNumber = request.param('phone_number');
    var verificationCode = request.param('verification_code');
    var password = request.param('password');
    var deviceId = request.param('device_id');

    if (!email || !phoneNumber || !verificationCode || !password || !deviceId) {
      console.log('Missing parameters.');
      return response.send(400, new FlipsError('Error requesting to update password.', 'Missing parameters.'));
    }

    User.findOne({
      username: Krypto.encrypt(email),
      phoneNumber: Krypto.encrypt(phoneNumber)
    }).exec(function (err, user) {
      if (err) {
        return response.send(500, new FlipsError('User error', 'Error trying to retrieve user'));
      }
      if (!user) {
        return response.send(404, new FlipsError('Username and/or phone number do not match any user', 'Username and/or phone number do not match any user'));
      }
      Device.findOne({user: user.id, id: deviceId})
        .populate('user')
        .exec(function (error, device) {
          if (error) {
            var errmsg = new FlipsError('Device error', 'Error when trying to retrieve device info');
            logger.error(errmsg);
            return response.send(500, errmsg);
          }
          if (!device) {
            return response.send(404, new FlipsError('Device not found.', 'device number = ' + phoneNumber));
          }
          if (device.verificationCode != verificationCode) {
            //if the verification code is wrong, it's probably an attack - so the code should be changed to avoid brute-force update
            device.verificationCode = Math.floor(Math.random() * 8999) + 1000;
            device.save();
            return response.send(400, new FlipsError('Wrong verification code.', 'Wrong verification code.'));
          }

          device.user = Krypto.decryptUser(device.user);

          var PASSWORD_REGEX = '^(?=.*?[A-Z])(?=.*?[a-z])(?=.*?[0-9]).{8,}$';

          if (!password.match(PASSWORD_REGEX)) {
            return response.send(400, new FlipsError('Password error', 'Password must have at least eight characters, one uppercase letter and one lowercase letter and one number.'));
          }

          var whereClause = {user: device.user.id};
          var updateColumns = {password: password};
          Passport.update(whereClause, updateColumns, function (error, affectedUsers) {
            if (error) {
              var errmsg = new FlipsError('Password error', 'Error updating passport.');
              logger.error(errmsg);
              return response.send(500, errmsg);
            }

            if (!affectedUsers || affectedUsers.length < 1) {
              return response.send(400, new FlipsError('Password error', "No rows affected while updating passport"));
            }

            return response.json(200, {});
          })

        })
    });

  },

  myRooms: function (request, response) {
    var userId = request.params.parentid;
    Room.query('select a.* from room a, participant b where a.id = b.room and b.user = ' + userId, function (err, rooms) {
      if (err) {
        return response.send(500, new FlipsError('Error when trying to retrieve rooms'));
      }
      if (!rooms) {
        return response.send(404, new FlipsError('Rooms not found'))
      }
      populateRooms(rooms, function (err, populatedRooms) {
        if (err) {
          return response.send(500, new FlipsError('Error when trying to retrieve rooms'));
        }
        return response.send(200, populatedRooms);
      });
    });
  },

  verifyContacts: function (request, response) {
    var contacts = request.param("phoneNumbers");
    for (var i = 0; i < contacts.length; i++) {
      contacts[i] = Krypto.encrypt(contacts[i]);
    }

    var subsetStart = 0;
    var subsetEnd = 0;
    var subsetSize = 500;
    var matchingContacts = [];

    function searchNextSubset() {
      subsetStart = subsetEnd;
      subsetEnd = Math.min(contacts.length, subsetEnd + subsetSize);

      if (subsetStart >= contacts.length) {
        returnResponse();
        return;
      }

      var subset = contacts.slice(subsetStart, subsetEnd);

      User.find()
        .where({phoneNumber: subset})
        .exec(function (err, users) {
          Array.prototype.push.apply(matchingContacts, users);
          searchNextSubset();
        })
    }

    function returnResponse() {
      Krypto.decryptUsers(matchingContacts, function(err, decryptedUsers) {
        if (err) {
          return response.send(200, []);
        } else {
          return response.send(200, removeUnwantedPropertiesFromUsers(decryptedUsers));
        }
      });
    }

    searchNextSubset();
  },

  verifyFacebookUsers: function (request, response) {
    var facebookIDs = request.param("facebookIDs");

    if (!facebookIDs || facebookIDs.length == 0) {
      return response.send(400, new FlipsError('Missing parameter', 'Facebook Ids is missing.'))
    }

    User.find({
      facebookID: facebookIDs
    }).exec(function (err, users) {
        Krypto.decryptUsers(users, function(err, decryptedUsers) {
          if (err) {
            return response.send(200, []);
          } else {
            return response.send(200, removeUnwantedPropertiesFromUsers(decryptedUsers));
          }
        });
      })
  },

  update: function (request, response) {
    var userId = request.params.parentid;
    var updatedValues = actionUtil.parseValues(request);
    var photo = request.file('photo');

    if (!userId) {
      return response.send(400, new FlipsError('Missing parameter: [User Id]'));
    }

    var PASSWORD_REGEX = '^(?=.*?[A-Z])(?=.*?[a-z])(?=.*?[0-9]).{8,}$';
    var password = updatedValues.password;

    if (password && !password.match(PASSWORD_REGEX)) {
      return response.send(400, new FlipsError('Password must have at least eight characters, one uppercase letter and one lowercase letter and one number.'));
    }

    User.findOne(userId).exec(function (err, user) {
      if (err) {
        return response.send(500, new FlipsError('Error when trying to retrieve user'));
      }
      if (!user) {
        return response.send(404, new FlipsError('User not found'));
      }
      if (updatedValues.firstName) {
        user.firstName = Krypto.encrypt(updatedValues.firstName);
      }
      if (updatedValues.lastName) {
        user.lastName = Krypto.encrypt(updatedValues.lastName);
      }
      if (updatedValues.username) {
        user.username = Krypto.encrypt(updatedValues.username);
      }
      if (updatedValues.phoneNumber) {
        user.phoneNumber = Krypto.encrypt(updatedValues.phoneNumber);
      }
      if (updatedValues.nickname) {
        user.nickname = Krypto.encrypt(updatedValues.nickname);
      }
      user.save(function (err) {
        if (err) {
          var errmsg = new FlipsError('Error trying to update user');
          logger.error(errmsg, err);
          return response.send(500, errmsg);
        }

        if (password) {
          var whereClause = {user: user.id}
          var updateColumns = {password: password}
          Passport.update(whereClause, updateColumns, function (error, affectedUsers) {
            if (error) {
              var errmsg = new FlipsError('Error updating passport.');
              logger.error(errmsg);
              return response.send(500, errmsg);
            }

            if (!affectedUsers || affectedUsers.length < 1) {
              return response.send(400, new FlipsError("No rows affected while updating passport"));
            }

            if (photo && photo._files.length >= 1) {
              s3service.upload(photo, s3service.PICTURES_BUCKET, function (err, uploadedFiles) {
                if (err) {
                  var errmsg = new FlipsError('Error uploading picture', err);
                  logger.error(errmsg);
                  return response.send(500, errmsg);
                }

                if (!uploadedFiles || uploadedFiles.length < 1) {
                  return response.send(400, new FlipsError('Error uploading file'));
                }

                var uploadedFile = uploadedFiles[0];

                user.photoUrl = s3service.S3_URL + s3service.PICTURES_BUCKET + '/' + uploadedFile.fd;
                user.save(function (err) {
                  if (err) {
                    var errmsg = new FlipsError('Error updating user', err);
                    logger.error(errmsg);
                    return response.send(500, errmsg);
                  }
                  return response.send(200, Krypto.decryptUser(user));
                });
              });
            } else {
              return response.send(200, Krypto.decryptUser(user));
            }

          });
        } else {

          if (photo && photo._files.length >= 1) {
            s3service.upload(photo, s3service.PICTURES_BUCKET, function (err, uploadedFiles) {
              if (err) {
                var errmsg = new FlipsError('Error uploading picture', err);
                logger.error(errmsg);
                return response.send(500, errmsg);
              }

              if (!uploadedFiles || uploadedFiles.length < 1) {
                return response.send(400, new FlipsError('Error uploading file'));
              }

              var uploadedFile = uploadedFiles[0];

              user.photoUrl = s3service.S3_URL + s3service.PICTURES_BUCKET + '/' + uploadedFile.fd;
              user.save(function (err) {
                if (err) {
                  var errmsg = new FlipsError('Error updating user', err);
                  logger.error(errmsg);
                  return response.send(500, errmsg);
                }
                return response.send(200, Krypto.decryptUser(user));
              });
            });
          } else {
            return response.send(200, Krypto.decryptUser(user));
          }

        }

      });
    });

  },

  findById: function (request, response) {
    var userId = request.params.parentid;
    User.findOne(userId).exec(function (err, user) {
      if (err) {
        return response.send(500, new FlipsError('Error retrieving user'));
      }
      if (!user) {
        return response.send(404, new FlipsError('User not found'));
      }
      return response.send(200, Krypto.decryptUser(user));
    });
  },

  printUsers: function (request, response) {
    User.find().exec(function (err, users) {
      Krypto.decryptUsers(users, function (err, decUsers) {
        response.send(200, decUsers);
      })
    });
  }

};

var sendVerificationCode = function (device, phoneNumber) {
  var verificationCode = Math.floor(Math.random() * 8999) + 1000;
  var message = 'Your Flips verification code: ' + verificationCode;

  device.verificationCode = verificationCode;
  device.isVerified = false;
  device.retryCount = 0;
  device.save();

  twilioService.sendSms(phoneNumber, message, function (err, message) {
    logger.info(err || message);
  });
};

var getParticipantsForRoom = function (roomId, callback) {
  Participant.find({room: roomId}).exec(function (err, participants) {
    if (err) {
      callback([]);
    } else {
      callback(participants);
    }
  });
};

var populateRooms = function (rooms, callback) {
  async.map(
    rooms,
    function (aRoom, transformedCallback) {
      getParticipantsForRoom(aRoom.id, function (participants) {
        var participantIds = [];
        for (var i = 0; i < participants.length; i++) {
          participantIds.push(participants[i].user);
        }
        User.find({id: participantIds}).exec(function (err, users) {
          if (err) {
            transformedCallback(null, []);
          } else {
            Krypto.decryptUsers(users, function (err, decryptedUsers) {
              if (err) {
                callback(null, []);
              } else {
                aRoom.participants = decryptedUsers;
                transformedCallback(null, removeUnwantedPropertiesFromParticipants(aRoom));
              }
            });
          }
        });
      })
    },
    function (err, populatedRooms) {
      callback(err, populatedRooms);
    });
};

var removeUnwantedPropertiesFromParticipants = function (aRoom) {
  var room = {
    id: aRoom.id,
    admin: aRoom.admin,
    name: aRoom.name,
    pubnubId: aRoom.pubnubId,
    createdAt: aRoom.createdAt,
    updatedAt: aRoom.updatedAt
  };
  room.participants = removeUnwantedPropertiesFromUsers(aRoom.participants);
  return room;
};

var removeUnwantedPropertiesFromUsers = function(users) {
  var transformedUsers = [];
  for (var i = 0; i < users.length; i++) {
    transformedUsers.push(removeUnwantedPropertiesFromUser(users[i]));
  }
  return transformedUsers;
};

var removeUnwantedPropertiesFromUser = function(aUser) {
  return {
    id: aUser.id,
    username: aUser.username,
    firstName: aUser.firstName,
    lastName: aUser.lastName,
    birthday: aUser.birthday,
    facebookId: aUser.facebookID,
    photoUrl: aUser.photoUrl,
    nickname: aUser.nickname,
    phoneNumber: aUser.phoneNumber,
    isTemporary: aUser.isTemporary,
    createdAt: aUser.createdAt,
    updatedAt: aUser.updatedAt
  };
};

module.exports = UserController;
