import { Resend } from 'resend';
import multiparty from 'multiparty';
import fs from 'fs';
import path from 'path';
import { v2 as cloudinary } from 'cloudinary';

// Initialize Resend with your API key
const resend = new Resend(process.env.RESEND_API_KEY);

// Initialize Cloudinary if credentials are provided
const useCloudinary = process.env.CLOUDINARY_CLOUD_NAME && 
                      process.env.CLOUDINARY_API_KEY && 
                      process.env.CLOUDINARY_API_SECRET;

if (useCloudinary) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
}

// Helper function to parse form data
const parseForm = (req) => {
  return new Promise((resolve, reject) => {
    const form = new multiparty.Form();
    
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
};

// Helper to get MIME type from file extension
const getMimeType = (filename) => {
  const ext = filename.toLowerCase().split('.').pop();
  const mimeTypes = {
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'webp': 'image/webp'
  };
  return mimeTypes[ext] || 'image/jpeg';
};

// Helper to convert file to base64 for Resend attachments
const fileToBase64 = async (filePath) => {
  // In Vercel serverless, multiparty saves files to /tmp automatically
  return new Promise((resolve, reject) => {
    fs.readFile(filePath, (err, data) => {
      if (err) {
        reject(err);
      } else {
        const base64 = data.toString('base64');
        // Clean up temporary file after reading
        fs.unlink(filePath, (unlinkErr) => {
          if (unlinkErr) console.warn('Failed to delete temp file:', unlinkErr);
        });
        resolve(base64);
      }
    });
  });
};

// Helper to upload image to Cloudinary
const uploadToCloudinary = async (filePath, filename, category) => {
  return new Promise((resolve, reject) => {
    // Use category as folder name for organization
    const folder = `commission-requests/${category}`;
    
    cloudinary.uploader.upload(
      filePath,
      {
        folder: folder,
        public_id: `${Date.now()}-${filename.replace(/\.[^/.]+$/, '')}`,
        resource_type: 'auto',
        quality: 'auto:good', // Auto quality optimization
        fetch_format: 'auto' // Auto format (webp when possible)
      },
      (error, result) => {
        // Clean up temporary file
        fs.unlink(filePath, () => {});
        
        if (error) {
          reject(error);
        } else {
          resolve({
            url: result.secure_url, // HTTPS URL for email display
            publicUrl: result.url, // Public HTTP URL (also accessible)
            publicId: result.public_id,
            width: result.width,
            height: result.height,
            format: result.format,
            bytes: result.bytes
          });
        }
      }
    );
  });
};

export default async function handler(req, res) {
  // Set CORS headers for all requests - MUST be set before any response
  const origin = req.headers.origin || '*';
  
  // Set all CORS headers
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin');
  res.setHeader('Access-Control-Allow-Credentials', 'false');
  res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours

  // Handle preflight request - MUST return early with headers
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Parse the multipart form data
    const { fields, files } = await parseForm(req);

    // Extract field values (multiparty returns arrays)
    const getValue = (field) => field && field[0] ? field[0] : '';
    
    const formData = {
      nombre: getValue(fields.nombre),
      contactType: getValue(fields.contactType),
      contactValue: getValue(fields.contactValue),
      tipo: getValue(fields.tipo),
      pose: getValue(fields.pose),
      outfit: getValue(fields.outfit),
      referencias: getValue(fields.referencias),
      descripcion: getValue(fields.descripcion)
    };

    // Organize images by category for inline display using Resend attachments
    const imageCategories = {
      'pose-imagen': [],
      'outfit-imagen': [],
      'referencias-imagen': []
    };
    
    // Track large images that will be sent as regular attachments
    const largeImageAttachments = {
      'pose-imagen': [],
      'outfit-imagen': [],
      'referencias-imagen': []
    };
    
    // Process each file field and organize by category
    const MAX_TOTAL_IMAGES = 20; // Total images
    let totalImages = 0;
    const inlineAttachments = [];
    const regularAttachments = [];
    
    // Map field names to category names for Cloudinary folders
    const categoryMap = {
      'pose-imagen': 'pose',
      'outfit-imagen': 'outfit',
      'referencias-imagen': 'referencias'
    };
    
    for (const fieldName of Object.keys(imageCategories)) {
      if (files[fieldName] && totalImages < MAX_TOTAL_IMAGES) {
        const fieldFiles = Array.isArray(files[fieldName]) ? files[fieldName] : [files[fieldName]];
        let processedCount = 0;
        
        for (let i = 0; i < fieldFiles.length && totalImages < MAX_TOTAL_IMAGES; i++) {
          const file = fieldFiles[i];
          
          try {
            if (useCloudinary) {
              // Upload to Cloudinary and use URL
              const category = categoryMap[fieldName] || 'other';
              const uploadResult = await uploadToCloudinary(file.path, file.originalFilename, category);
              
              // Store image info for HTML with Cloudinary URL
              imageCategories[fieldName].push({
                url: uploadResult.url, // HTTPS URL for display
                publicUrl: uploadResult.publicUrl, // Public URL for clicking
                filename: file.originalFilename,
                isCloudinary: true,
                width: uploadResult.width,
                height: uploadResult.height,
                size: uploadResult.bytes
              });
              
              console.log(`Uploaded ${file.originalFilename} to Cloudinary: ${uploadResult.url}`);
            } else {
              // Use Resend attachments (original method)
              const stats = fs.statSync(file.path);
              const MAX_INLINE_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB for inline images
              const MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024; // 25MB max per attachment
              
              // Skip if exceeds Resend's maximum attachment size
              if (stats.size > MAX_ATTACHMENT_SIZE) {
                console.warn(`Image ${file.originalFilename} exceeds maximum size (${(stats.size / 1024 / 1024).toFixed(2)}MB), skipping`);
                fs.unlink(file.path, () => {});
                continue;
              }
              
              const base64Content = await fileToBase64(file.path);
              const mimeType = getMimeType(file.originalFilename);
              
              if (stats.size <= MAX_INLINE_IMAGE_SIZE) {
                // Small enough for inline display
                const cid = `${fieldName}-${totalImages}`;
                
                // Store image info for HTML
                imageCategories[fieldName].push({
                  cid: cid,
                  filename: file.originalFilename,
                  isInline: true
                });
                
                // Add to inline attachments for Resend
                inlineAttachments.push({
                  filename: file.originalFilename,
                  content: base64Content,
                  cid: cid,
                  content_type: mimeType
                });
              } else {
                // Too large for inline, send as regular attachment
                console.log(`Image ${file.originalFilename} (${(stats.size / 1024 / 1024).toFixed(2)}MB) will be sent as attachment`);
                
                // Store info for HTML (to show a note that it's attached)
                imageCategories[fieldName].push({
                  filename: file.originalFilename,
                  isInline: false,
                  size: stats.size
                });
                
                // Add to regular attachments (no CID)
                regularAttachments.push({
                  filename: file.originalFilename,
                  content: base64Content,
                  content_type: mimeType
                });
                
                largeImageAttachments[fieldName].push(file.originalFilename);
              }
            }
            
            totalImages++;
            processedCount++;
          } catch (error) {
            console.error(`Error processing image ${file.originalFilename}:`, error);
            // Clean up file on error
            if (fs.existsSync(file.path)) {
              fs.unlink(file.path, () => {});
            }
          }
        }
        
        // Clean up any remaining unprocessed files in this category
        for (let i = processedCount; i < fieldFiles.length; i++) {
          const file = fieldFiles[i];
          if (fs.existsSync(file.path)) {
            fs.unlink(file.path, () => {});
          }
        }
      }
    }

    // Create HTML email content
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      font-family: 'Arial', sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
    }
    .header {
      background: linear-gradient(135deg, #ec4078 0%, #ff6b9d 100%);
      color: white;
      padding: 30px;
      text-align: center;
      border-radius: 10px 10px 0 0;
    }
    .header h1 {
      margin: 0;
      font-size: 28px;
    }
    .content {
      background: #ffffff;
      padding: 30px;
      border: 1px solid #f8bbd0;
      border-top: none;
      border-radius: 0 0 10px 10px;
    }
    .field {
      margin-bottom: 20px;
    }
    .field-label {
      font-weight: bold;
      color: #c2185b;
      display: block;
      margin-bottom: 5px;
    }
    .field-value {
      background: #fce4ec;
      padding: 10px;
      border-radius: 5px;
      border-left: 3px solid #ec4078;
    }
    .images-container {
      margin-top: 10px;
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }
    .image-item {
      max-width: 400px;
      max-height: 400px;
      border-radius: 8px;
      border: 2px solid #f8bbd0;
      overflow: hidden;
      margin-bottom: 10px;
    }
    .image-item img {
      width: 100%;
      height: auto;
      max-height: 400px;
      object-fit: contain;
      display: block;
    }
    .attachment-note {
      background: #fff3cd;
      padding: 10px;
      border-radius: 5px;
      border-left: 3px solid #ffc107;
      margin-top: 5px;
      font-size: 12px;
      color: #856404;
    }
    .footer {
      text-align: center;
      margin-top: 20px;
      padding: 20px;
      color: #999;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>♥ New Commission Request ♥</h1>
  </div>
  <div class="content">
    <div class="field">
      <span class="field-label">Name:</span>
      <div class="field-value">${formData.nombre}</div>
    </div>

    <div class="field">
      <span class="field-label">Contact:</span>
      <div class="field-value">${formData.contactType}: ${formData.contactValue}</div>
    </div>

    <div class="field">
      <span class="field-label">Commission Type:</span>
      <div class="field-value">${formData.tipo}</div>
    </div>

    <div class="field">
      <span class="field-label">Pose:</span>
      <div class="field-value">${formData.pose}</div>
      ${imageCategories['pose-imagen'].length > 0 ? `
      <div class="images-container">
        ${imageCategories['pose-imagen'].map(img => {
          if (img.isCloudinary) {
            return `
          <div class="image-item">
            <a href="${img.publicUrl}" target="_blank" rel="noopener noreferrer" style="display: block;">
              <img src="${img.url}" alt="Pose reference" style="max-width: 100%; height: auto; cursor: pointer; border: 2px solid #f8bbd0; border-radius: 8px;" />
            </a>
            <div style="text-align: center; margin-top: 5px; font-size: 11px; color: #999;">Click to view full size</div>
          </div>`;
          } else if (img.isInline) {
            return `
          <div class="image-item">
            <img src="cid:${img.cid}" alt="Pose reference" />
          </div>`;
          } else {
            return `
          <div class="attachment-note">
            📎 ${img.filename} (${(img.size / 1024 / 1024).toFixed(2)}MB) - attached to email
          </div>`;
          }
        }).join('')}
      </div>
      ` : ''}
    </div>

    ${formData.outfit ? `
    <div class="field">
      <span class="field-label">Outfit:</span>
      <div class="field-value">${formData.outfit}</div>
      ${imageCategories['outfit-imagen'].length > 0 ? `
      <div class="images-container">
        ${imageCategories['outfit-imagen'].map(img => {
          if (img.isCloudinary) {
            return `
          <div class="image-item">
            <a href="${img.publicUrl}" target="_blank" rel="noopener noreferrer" style="display: block;">
              <img src="${img.url}" alt="Outfit reference" style="max-width: 100%; height: auto; cursor: pointer; border: 2px solid #f8bbd0; border-radius: 8px;" />
            </a>
            <div style="text-align: center; margin-top: 5px; font-size: 11px; color: #999;">Click to view full size</div>
          </div>`;
          } else if (img.isInline) {
            return `
          <div class="image-item">
            <img src="cid:${img.cid}" alt="Outfit reference" />
          </div>`;
          } else {
            return `
          <div class="attachment-note">
            📎 ${img.filename} (${(img.size / 1024 / 1024).toFixed(2)}MB) - attached to email
          </div>`;
          }
        }).join('')}
      </div>
      ` : ''}
    </div>
    ` : ''}

    <div class="field">
      <span class="field-label">References:</span>
      <div class="field-value">${formData.referencias}</div>
      ${imageCategories['referencias-imagen'].length > 0 ? `
      <div class="images-container">
        ${imageCategories['referencias-imagen'].map(img => {
          if (img.isCloudinary) {
            return `
          <div class="image-item">
            <a href="${img.publicUrl}" target="_blank" rel="noopener noreferrer" style="display: block;">
              <img src="${img.url}" alt="Reference image" style="max-width: 100%; height: auto; cursor: pointer; border: 2px solid #f8bbd0; border-radius: 8px;" />
            </a>
            <div style="text-align: center; margin-top: 5px; font-size: 11px; color: #999;">Click to view full size</div>
          </div>`;
          } else if (img.isInline) {
            return `
          <div class="image-item">
            <img src="cid:${img.cid}" alt="Reference image" />
          </div>`;
          } else {
            return `
          <div class="attachment-note">
            📎 ${img.filename} (${(img.size / 1024 / 1024).toFixed(2)}MB) - attached to email
          </div>`;
          }
        }).join('')}
      </div>
      ` : ''}
    </div>

    <div class="field">
      <span class="field-label">Description:</span>
      <div class="field-value">${formData.descripcion}</div>
    </div>
  </div>
  <div class="footer">
    This is an automated message from your Commission Request Form
  </div>
</body>
</html>
    `;

    // Combine inline and regular attachments
    const allAttachments = [...inlineAttachments, ...regularAttachments];
    
    // Check if using Resend template (set RESEND_TEMPLATE_ID in environment variables)
    const templateId = process.env.RESEND_TEMPLATE_ID;
    
    let emailResponse;
    
    if (templateId) {
      // Use Resend template with variables
      emailResponse = await resend.emails.send({
        from: 'Commission Form <onboarding@resend.dev>',
        to: process.env.RECIPIENT_EMAIL,
        template_id: templateId,
        template_data: {
          nombre: formData.nombre,
          contactType: formData.contactType,
          contactValue: formData.contactValue,
          tipo: formData.tipo,
          pose: formData.pose,
          outfit: formData.outfit || '',
          referencias: formData.referencias,
          descripcion: formData.descripcion,
          poseImages: imageCategories['pose-imagen'],
          outfitImages: imageCategories['outfit-imagen'],
          referenciasImages: imageCategories['referencias-imagen']
        },
        attachments: allAttachments.length > 0 ? allAttachments : undefined
      });
    } else {
      // Send email with custom HTML (images embedded as inline attachments with CID)
      emailResponse = await resend.emails.send({
        from: 'Commission Form <onboarding@resend.dev>', // Cambia esto a tu dominio verificado
        to: process.env.RECIPIENT_EMAIL, // Email donde recibirás las solicitudes
        subject: `New Commission Request from ${formData.nombre}`,
        html: htmlContent,
        attachments: allAttachments.length > 0 ? allAttachments : undefined
      });
    }

    console.log('Email sent successfully:', emailResponse);

    return res.status(200).json({ 
      success: true, 
      message: 'Email sent successfully',
      id: emailResponse.id 
    });

  } catch (error) {
    console.error('Error processing request:', error);
    return res.status(500).json({ 
      error: 'Failed to send email',
      details: error.message 
    });
  }
}
