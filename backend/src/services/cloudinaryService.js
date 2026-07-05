// Image storage via Cloudinary. Used by the incident controller to store an
// optional photo and get back a hosted URL.
'use strict';

const cloudinary = require('../config/cloudinary');

// Upload an image buffer (e.g. from multer memoryStorage) into `folder`.
// Resolves with the hosted secure (https) URL. The stream form lets us upload
// raw bytes without needing the file's mimetype.
function uploadImage(buffer, folder) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ folder }, (error, result) => {
      if (error) {
        return reject(error);
      }
      resolve(result.secure_url);
    });
    stream.end(buffer);
  });
}

module.exports = { uploadImage };
