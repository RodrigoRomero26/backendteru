import { Resend } from 'resend';
import multiparty from 'multiparty';
import fs from 'fs';
import path from 'path';

// Initialize Resend with your API key
const resend = new Resend(process.env.RESEND_API_KEY);

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

// Helper to convert file to base64
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

    // Organize images by category for inline display
    const imageCategories = {
      'pose-imagen': [],
      'outfit-imagen': [],
      'referencias-imagen': []
    };
    
    // Process each file field and organize by category
    for (const fieldName of Object.keys(imageCategories)) {
      if (files[fieldName]) {
        const fieldFiles = Array.isArray(files[fieldName]) ? files[fieldName] : [files[fieldName]];
        
        for (let i = 0; i < fieldFiles.length; i++) {
          const file = fieldFiles[i];
          const content = await fileToBase64(file.path);
          const cid = `${fieldName}-${i}`;
          
          imageCategories[fieldName].push({
            cid: cid,
            filename: file.originalFilename,
            content: content
          });
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
      max-width: 200px;
      max-height: 200px;
      border-radius: 8px;
      border: 2px solid #f8bbd0;
      overflow: hidden;
    }
    .image-item img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
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
        ${imageCategories['pose-imagen'].map(img => `
          <div class="image-item">
            <img src="cid:${img.cid}" alt="Pose reference" />
          </div>
        `).join('')}
      </div>
      ` : ''}
    </div>

    ${formData.outfit ? `
    <div class="field">
      <span class="field-label">Outfit:</span>
      <div class="field-value">${formData.outfit}</div>
      ${imageCategories['outfit-imagen'].length > 0 ? `
      <div class="images-container">
        ${imageCategories['outfit-imagen'].map(img => `
          <div class="image-item">
            <img src="cid:${img.cid}" alt="Outfit reference" />
          </div>
        `).join('')}
      </div>
      ` : ''}
    </div>
    ` : ''}

    <div class="field">
      <span class="field-label">References:</span>
      <div class="field-value">${formData.referencias}</div>
      ${imageCategories['referencias-imagen'].length > 0 ? `
      <div class="images-container">
        ${imageCategories['referencias-imagen'].map(img => `
          <div class="image-item">
            <img src="cid:${img.cid}" alt="Reference image" />
          </div>
        `).join('')}
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

    // Prepare inline attachments (images embedded in email)
    const inlineAttachments = [];
    for (const category of Object.keys(imageCategories)) {
      for (const img of imageCategories[category]) {
        inlineAttachments.push({
          filename: img.filename,
          content: img.content,
          cid: img.cid
        });
      }
    }

    // Send email using Resend
    const emailResponse = await resend.emails.send({
      from: 'Commission Form <onboarding@resend.dev>', // Cambia esto a tu dominio verificado
      to: process.env.RECIPIENT_EMAIL, // Email donde recibirás las solicitudes
      subject: `New Commission Request from ${formData.nombre}`,
      html: htmlContent,
      attachments: inlineAttachments.length > 0 ? inlineAttachments : undefined
    });

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
