// Cloudinary SDK init — configured once and shared. Used to store incident
// photos (see services/cloudinaryService.js). Credentials come from env.
'use strict';

const { v2: cloudinary } = require('cloudinary');
const config = require('./env');

cloudinary.config({
  cloud_name: config.CLOUDINARY_CLOUD_NAME,
  api_key: config.CLOUDINARY_API_KEY,
  api_secret: config.CLOUDINARY_API_SECRET,
});

module.exports = cloudinary;
