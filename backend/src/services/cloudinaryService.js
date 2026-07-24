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

// Upload a non-image file buffer (e.g. a .pptx deck) into `folder`.
// resource_type 'raw' stores the bytes verbatim; public_id keeps the file
// extension so the download opens in PowerPoint. Resolves with the https URL.
function uploadRaw(buffer, folder, filename) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'raw', public_id: filename },
      (error, result) => {
        if (error) {
          return reject(error);
        }
        resolve(result.secure_url);
      }
    );
    stream.end(buffer);
  });
}

// Upload a generated report PDF buffer into the `reports` folder (UC-009).
// Thin wrapper over uploadRaw: PDFs are stored verbatim as raw bytes with the
// given file name as the public_id. Resolves with the hosted https URL.
function uploadReport(pdfBuffer, fileName) {
  return uploadRaw(pdfBuffer, 'reports', fileName);
}

module.exports = { uploadImage, uploadRaw, uploadReport };
