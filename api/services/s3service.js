var S3Service = {

  upload: function(file, upload_bucket, callback) {
    file.upload({
      adapter: require('skipper-s3'),
      bucket: upload_bucket,
      key: process.env.AWS_S3_KEY,
      secret: process.env.AWS_S3_SECRET
    }, callback);
  },

  PICTURES_BUCKET: 'flips-pictures',
  BACKGROUND_BUCKET: 'flips-background',
  SOUND_BUCKET: 'flips-sound'

};

module.exports = S3Service;