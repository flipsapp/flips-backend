/**
 * Policy Mappings
 * (sails.config.policies)
 *
 * Policies are simple functions which run **before** your controllers.
 * You can apply one or more policies to a given controller, or protect
 * its actions individually.
 *
 * Any policy file (e.g. `api/policies/authenticated.js`) can be accessed
 * below by its filename, minus the extension, (e.g. "authenticated")
 *
 * For more information on how policies work, see:
 * http://sailsjs.org/#/documentation/concepts/Policies
 *
 * For more information on configuring policies, check out:
 * http://sailsjs.org/#/documentation/reference/sails.config/sails.config.policies.html
 */


module.exports.policies = {

  /***************************************************************************
  *                                                                          *
  * Default policy for all controllers and actions (`true` allows public     *
  * access)                                                                  *
  *                                                                          *
  ***************************************************************************/

  '*': ['passport'],

  UserController: {
    forgot: true,
    verify: true,
    uploadPhoto: ['passport', 'owner'],
    update: ['passport', 'owner'],
    findOne: ['passport', 'owner'],
    populate: ['passport', 'owner']
  },

	MugController: {
    create: ['passport', 'mugOwner'],
    uploadBackground: ['passport'],
    uploadSound: ['passport'],
    updateBackground: ['passport', 'mugOwner'],
    updateSound: ['passport', 'mugOwner'],
    myMugs: ['passport', 'mugOwner'],
    mugById: ['passport', 'mugOwner'],
    stockMugs: ['passport']
  },

  DeviceController: {
    findOne: ['passport', 'owner', 'deviceOwner'],
    create : ['passport', 'owner'],
    verify : ['passport']
  },

  RoomController: {
    create: ['passport', 'owner'],
    updateParticipants: ['passport', 'owner'],
    update: ['passport', 'owner'],
    destroy: ['passport', 'owner']
  }
};
