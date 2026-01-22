"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteFile = exports.getPresignedUrl = exports.uploadMultiple = exports.uploadDirect = exports.upload = void 0;
const client_s3_1 = require("@aws-sdk/client-s3");
const s3_presigned_post_1 = require("@aws-sdk/s3-presigned-post");
const multer_1 = __importDefault(require("multer"));
const sharp_1 = __importDefault(require("sharp"));
const uuid_1 = require("uuid");
// Initialize S3 client
const s3Client = new client_s3_1.S3Client({
    region: process.env.AWS_REGION || 'eu-west-2',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
});
// Configure multer for memory storage
const storage = multer_1.default.memoryStorage();
exports.upload = (0, multer_1.default)({
    storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB
    },
    fileFilter: (req, file, cb) => {
        // Accept images only
        if (!file.mimetype.startsWith('image/')) {
            return cb(new Error('Only image files are allowed'));
        }
        cb(null, true);
    },
});
// Upload file directly to S3
const uploadDirect = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'No file uploaded',
            });
        }
        const { folder = 'uploads', convertToWebp = 'true' } = req.body;
        let fileBuffer = req.file.buffer;
        let mimeType = req.file.mimetype;
        let fileExtension = req.file.originalname.split('.').pop() || 'jpg';
        // Convert to WebP if requested and it's an image
        if (convertToWebp === 'true' && req.file.mimetype.startsWith('image/')) {
            try {
                fileBuffer = await (0, sharp_1.default)(req.file.buffer)
                    .webp({ quality: 80 })
                    .toBuffer();
                mimeType = 'image/webp';
                fileExtension = 'webp';
            }
            catch (error) {
                console.error('Error converting to WebP:', error);
                // Continue with original file if conversion fails
            }
        }
        // Generate unique filename
        const fileName = `${(0, uuid_1.v4)()}.${fileExtension}`;
        const key = `${folder}/${fileName}`;
        // Upload to S3 with public-read ACL
        const command = new client_s3_1.PutObjectCommand({
            Bucket: process.env.AWS_S3_BUCKET,
            Key: key,
            Body: fileBuffer,
            ContentType: mimeType,
            ACL: 'public-read', // Make the file publicly accessible
        });
        await s3Client.send(command);
        // Return the file URL
        const fileUrl = `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION || 'eu-west-2'}.amazonaws.com/${key}`;
        res.status(200).json({
            success: true,
            url: fileUrl, // Return 'url' field for consistency
            fileUrl, // Keep fileUrl for backward compatibility
            key,
        });
    }
    catch (error) {
        console.error('Error uploading file:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to upload file',
        });
    }
};
exports.uploadDirect = uploadDirect;
// Upload multiple files
const uploadMultiple = async (req, res) => {
    try {
        const files = req.files;
        if (!files || files.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No files uploaded',
            });
        }
        const { folder = 'uploads', convertToWebp = 'true' } = req.body;
        const uploadedFiles = [];
        for (const file of files) {
            let fileBuffer = file.buffer;
            let mimeType = file.mimetype;
            let fileExtension = file.originalname.split('.').pop() || 'jpg';
            // Convert to WebP if requested
            if (convertToWebp === 'true' && file.mimetype.startsWith('image/')) {
                try {
                    fileBuffer = await (0, sharp_1.default)(file.buffer)
                        .webp({ quality: 80 })
                        .toBuffer();
                    mimeType = 'image/webp';
                    fileExtension = 'webp';
                }
                catch (error) {
                    console.error('Error converting to WebP:', error);
                }
            }
            const fileName = `${(0, uuid_1.v4)()}.${fileExtension}`;
            const key = `${folder}/${fileName}`;
            const command = new client_s3_1.PutObjectCommand({
                Bucket: process.env.AWS_S3_BUCKET,
                Key: key,
                Body: fileBuffer,
                ContentType: mimeType,
                ACL: 'public-read',
            });
            await s3Client.send(command);
            const fileUrl = `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION || 'eu-west-2'}.amazonaws.com/${key}`;
            uploadedFiles.push({
                fileUrl,
                key,
                originalName: file.originalname,
            });
        }
        res.status(200).json({
            success: true,
            files: uploadedFiles,
        });
    }
    catch (error) {
        console.error('Error uploading files:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to upload files',
        });
    }
};
exports.uploadMultiple = uploadMultiple;
// Generate presigned POST URL for direct browser upload
const getPresignedUrl = async (req, res) => {
    try {
        const { fileName, fileType, folder = 'uploads' } = req.body;
        if (!fileName || !fileType) {
            return res.status(400).json({
                success: false,
                message: 'fileName and fileType are required',
            });
        }
        // Generate unique key
        const fileExtension = fileName.split('.').pop() || 'jpg';
        const key = `${folder}/${(0, uuid_1.v4)()}.${fileExtension}`;
        // Create presigned POST data
        const { url, fields } = await (0, s3_presigned_post_1.createPresignedPost)(s3Client, {
            Bucket: process.env.AWS_S3_BUCKET,
            Key: key,
            Conditions: [
                ['content-length-range', 0, 10 * 1024 * 1024], // 10MB max
                ['starts-with', '$Content-Type', fileType],
            ],
            Fields: {
                'Content-Type': fileType,
            },
            Expires: 600, // 10 minutes
        });
        // Return the presigned URL and form fields
        res.status(200).json({
            uploadUrl: url,
            fileUrl: `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION || 'eu-west-2'}.amazonaws.com/${key}`,
            fields,
        });
    }
    catch (error) {
        console.error('Error generating presigned URL:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to generate presigned URL',
        });
    }
};
exports.getPresignedUrl = getPresignedUrl;
// Delete file from S3
const deleteFile = async (req, res) => {
    try {
        const { key, url } = req.body;
        if (!key && !url) {
            return res.status(400).json({
                success: false,
                message: 'Either key or url is required',
            });
        }
        // Extract key from URL if only URL is provided
        let fileKey = key;
        if (!fileKey && url) {
            // Extract key from S3 URL
            // Format: https://bucket.s3.region.amazonaws.com/folder/file.ext
            const urlParts = url.split('.amazonaws.com/');
            if (urlParts.length > 1) {
                fileKey = urlParts[1];
            }
            else {
                // Alternative format: https://s3.region.amazonaws.com/bucket/folder/file.ext
                const altParts = url.split(`/${process.env.AWS_S3_BUCKET}/`);
                if (altParts.length > 1) {
                    fileKey = altParts[1];
                }
            }
        }
        if (!fileKey) {
            return res.status(400).json({
                success: false,
                message: 'Could not extract file key from URL',
            });
        }
        // Delete from S3
        const command = new client_s3_1.DeleteObjectCommand({
            Bucket: process.env.AWS_S3_BUCKET,
            Key: fileKey,
        });
        await s3Client.send(command);
        res.status(200).json({
            success: true,
            message: 'File deleted successfully',
            key: fileKey,
        });
    }
    catch (error) {
        console.error('Error deleting file:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to delete file',
        });
    }
};
exports.deleteFile = deleteFile;
