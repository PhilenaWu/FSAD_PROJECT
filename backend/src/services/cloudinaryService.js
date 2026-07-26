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
//
// PDFs are uploaded through Cloudinary's IMAGE pipeline (resource_type 'image',
// format 'pdf') — not 'raw'. Raw delivery serves a generic content type, so the
// browser renders the bytes inline as text (the "gibberish" symptom); the image
// pipeline delivers the correct application/pdf type.
//
// The returned URL uses fl_attachment so clicking it downloads a proper
// `<name>.pdf` file instead of trying to render it inline. Resolves with that
// https URL.
function uploadReport(pdfBuffer, fileName) {
  // public_id without extension — Cloudinary appends the format.
  const publicId = fileName.replace(/\.pdf$/i, '');
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: 'reports',
        public_id: publicId,
        resource_type: 'image',
        format: 'pdf',
        overwrite: true,
      },
      (error, result) => {
        if (error) {
          return reject(error);
        }
        // Force an attachment download with the correct content type/filename.
        const url = cloudinary.url(result.public_id, {
          resource_type: 'image',
          format: 'pdf',
          secure: true,
          flags: 'attachment',
        });
        resolve(url);
      }
    );
    stream.end(pdfBuffer);
  });
}

module.exports = { uploadImage, uploadRaw, uploadReport };
