//@ts-nocheck
import { Request, Response } from 'express';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import multer from 'multer';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';

// Initialize S3 client
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'eu-west-2',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

// Configure multer for memory storage
const storage = multer.memoryStorage();
export const upload = multer({
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
export const uploadDirect = async (req: Request, res: Response) => {
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
        fileBuffer = await sharp(req.file.buffer)
          .webp({ quality: 80 })
          .toBuffer();
        mimeType = 'image/webp';
        fileExtension = 'webp';
      } catch (error) {
        console.error('Error converting to WebP:', error);
        // Continue with original file if conversion fails
      }
    }

    // Generate unique filename
    const fileName = `${uuidv4()}.${fileExtension}`;
    const key = `${folder}/${fileName}`;

    // Upload to S3 with public-read ACL
    const command = new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET!,
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
  } catch (error: any) {
    console.error('Error uploading file:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to upload file',
    });
  }
};

// Upload multiple files
export const uploadMultiple = async (req: Request, res: Response) => {
  try {
    const files = req.files as Express.Multer.File[];
    
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
          fileBuffer = await sharp(file.buffer)
            .webp({ quality: 80 })
            .toBuffer();
          mimeType = 'image/webp';
          fileExtension = 'webp';
        } catch (error) {
          console.error('Error converting to WebP:', error);
        }
      }

      const fileName = `${uuidv4()}.${fileExtension}`;
      const key = `${folder}/${fileName}`;

      const command = new PutObjectCommand({
        Bucket: process.env.AWS_S3_BUCKET!,
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
  } catch (error: any) {
    console.error('Error uploading files:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to upload files',
    });
  }
};

// Generate presigned POST URL for direct browser upload
export const getPresignedUrl = async (req: Request, res: Response) => {
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
    const key = `${folder}/${uuidv4()}.${fileExtension}`;

    // Create presigned POST data
    const { url, fields } = await createPresignedPost(s3Client, {
      Bucket: process.env.AWS_S3_BUCKET!,
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
  } catch (error: any) {
    console.error('Error generating presigned URL:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to generate presigned URL',
    });
  }
};

// Delete file from S3
export const deleteFile = async (req: Request, res: Response) => {
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
        message: 'Could not extract file key from URL',
      });
    }

    // Delete from S3
    const command = new DeleteObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET!,
      Key: fileKey,
    });

    await s3Client.send(command);

    res.status(200).json({
      success: true,
      message: 'File deleted successfully',
      key: fileKey,
    });
  } catch (error: any) {
    console.error('Error deleting file:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to delete file',
    });
  }
};
