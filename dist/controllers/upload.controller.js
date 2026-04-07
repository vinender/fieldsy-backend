//@ts-nocheck
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: Object.getOwnPropertyDescriptor(all, name).get
    });
}
_export(exports, {
    get deleteFile () {
        return deleteFile;
    },
    get getPresignedUrl () {
        return getPresignedUrl;
    },
    get upload () {
        return upload;
    },
    get uploadDirect () {
        return uploadDirect;
    },
    get uploadMultiple () {
        return uploadMultiple;
    }
});
const _clients3 = require("@aws-sdk/client-s3");
const _s3presignedpost = require("@aws-sdk/s3-presigned-post");
const _multer = /*#__PURE__*/ _interop_require_default(require("multer"));
const _sharp = /*#__PURE__*/ _interop_require_default(require("sharp"));
const _uuid = require("uuid");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
// Initialize S3 client
const s3Client = new _clients3.S3Client({
    region: process.env.AWS_REGION || 'eu-west-2',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});
// Configure multer for memory storage
const storage = _multer.default.memoryStorage();
const upload = (0, _multer.default)({
    storage,
    limits: {
        fileSize: 10 * 1024 * 1024
    },
    fileFilter: (req, file, cb)=>{
        // Accept images only
        if (!file.mimetype.startsWith('image/')) {
            return cb(new Error('Only image files are allowed'));
        }
        cb(null, true);
    }
});
const uploadDirect = async (req, res)=>{
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'No file uploaded'
            });
        }
        const { folder = 'uploads', convertToWebp = 'true' } = req.body;
        let fileBuffer = req.file.buffer;
        let mimeType = req.file.mimetype;
        let fileExtension = req.file.originalname.split('.').pop() || 'jpg';
        // Convert to WebP if requested and it's an image
        if (convertToWebp === 'true' && req.file.mimetype.startsWith('image/')) {
            try {
                fileBuffer = await (0, _sharp.default)(req.file.buffer).webp({
                    quality: 80
                }).toBuffer();
                mimeType = 'image/webp';
                fileExtension = 'webp';
            } catch (error) {
                console.error('Error converting to WebP:', error);
            // Continue with original file if conversion fails
            }
        }
        // Generate unique filename
        const fileName = `${(0, _uuid.v4)()}.${fileExtension}`;
        const key = `${folder}/${fileName}`;
        // Upload to S3 with public-read ACL
        const command = new _clients3.PutObjectCommand({
            Bucket: process.env.AWS_S3_BUCKET,
            Key: key,
            Body: fileBuffer,
            ContentType: mimeType,
            ACL: 'public-read'
        });
        await s3Client.send(command);
        // Return the file URL
        const fileUrl = `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION || 'eu-west-2'}.amazonaws.com/${key}`;
        res.status(200).json({
            success: true,
            url: fileUrl,
            fileUrl,
            key
        });
    } catch (error) {
        console.error('Error uploading file:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to upload file'
        });
    }
};
const uploadMultiple = async (req, res)=>{
    try {
        const files = req.files;
        if (!files || files.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No files uploaded'
            });
        }
        const { folder = 'uploads', convertToWebp = 'true' } = req.body;
        const uploadedFiles = [];
        for (const file of files){
            let fileBuffer = file.buffer;
            let mimeType = file.mimetype;
            let fileExtension = file.originalname.split('.').pop() || 'jpg';
            // Convert to WebP if requested
            if (convertToWebp === 'true' && file.mimetype.startsWith('image/')) {
                try {
                    fileBuffer = await (0, _sharp.default)(file.buffer).webp({
                        quality: 80
                    }).toBuffer();
                    mimeType = 'image/webp';
                    fileExtension = 'webp';
                } catch (error) {
                    console.error('Error converting to WebP:', error);
                }
            }
            const fileName = `${(0, _uuid.v4)()}.${fileExtension}`;
            const key = `${folder}/${fileName}`;
            const command = new _clients3.PutObjectCommand({
                Bucket: process.env.AWS_S3_BUCKET,
                Key: key,
                Body: fileBuffer,
                ContentType: mimeType,
                ACL: 'public-read'
            });
            await s3Client.send(command);
            const fileUrl = `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION || 'eu-west-2'}.amazonaws.com/${key}`;
            uploadedFiles.push({
                fileUrl,
                key,
                originalName: file.originalname
            });
        }
        res.status(200).json({
            success: true,
            files: uploadedFiles
        });
    } catch (error) {
        console.error('Error uploading files:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to upload files'
        });
    }
};
const getPresignedUrl = async (req, res)=>{
    try {
        const { fileName, fileType, folder = 'uploads' } = req.body;
        if (!fileName || !fileType) {
            return res.status(400).json({
                success: false,
                message: 'fileName and fileType are required'
            });
        }
        // Generate unique key
        const fileExtension = fileName.split('.').pop() || 'jpg';
        const key = `${folder}/${(0, _uuid.v4)()}.${fileExtension}`;
        // Create presigned POST data
        const { url, fields } = await (0, _s3presignedpost.createPresignedPost)(s3Client, {
            Bucket: process.env.AWS_S3_BUCKET,
            Key: key,
            Conditions: [
                [
                    'content-length-range',
                    0,
                    10 * 1024 * 1024
                ],
                [
                    'starts-with',
                    '$Content-Type',
                    fileType
                ]
            ],
            Fields: {
                'Content-Type': fileType
            },
            Expires: 600
        });
        // Return the presigned URL and form fields
        res.status(200).json({
            uploadUrl: url,
            fileUrl: `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION || 'eu-west-2'}.amazonaws.com/${key}`,
            fields
        });
    } catch (error) {
        console.error('Error generating presigned URL:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to generate presigned URL'
        });
    }
};
const deleteFile = async (req, res)=>{
    try {
        const { key, url } = req.body;
        if (!key && !url) {
            return res.status(400).json({
                success: false,
                message: 'Either key or url is required'
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
            } else {
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
                message: 'Could not extract file key from URL'
            });
        }
        // Delete from S3
        const command = new _clients3.DeleteObjectCommand({
            Bucket: process.env.AWS_S3_BUCKET,
            Key: fileKey
        });
        await s3Client.send(command);
        res.status(200).json({
            success: true,
            message: 'File deleted successfully',
            key: fileKey
        });
    } catch (error) {
        console.error('Error deleting file:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to delete file'
        });
    }
};

//# sourceMappingURL=upload.controller.js.map