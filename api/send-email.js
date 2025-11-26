import { Resend } from 'resend';

// Initialize Resend with your API key
const resend = new Resend(process.env.RESEND_API_KEY);

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
    // Parse JSON body (images are already uploaded to Cloudinary from frontend)
    let body;
    try {
      body = await new Promise((resolve, reject) => {
        let data = '';
        req.on('data', chunk => {
          data += chunk.toString();
        });
        req.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('Invalid JSON'));
          }
        });
        req.on('error', reject);
      });
    } catch (parseError) {
      return res.status(400).json({ 
        error: 'Invalid request format',
        details: 'Expected JSON body with form data and image URLs'
      });
    }
    
    const formData = {
      nombre: body.nombre || '',
      contactType: body.contactType || '',
      contactValue: body.contactValue || '',
      tipo: body.tipo || '',
      pose: body.pose || '',
      outfit: body.outfit || '',
      referencias: body.referencias || '',
      descripcion: body.descripcion || ''
    };
    
    // Get image URLs from request (already uploaded to Cloudinary)
    const imageUrls = body.images || {};

    // Function to generate contact link based on contact type
    function getContactLink(contactType, contactValue) {
      if (!contactValue) return null;
      
      // Remove @ symbol if present
      const cleanValue = contactValue.replace(/^@/, '').trim();
      
      switch (contactType.toLowerCase()) {
        case 'instagram':
          // Instagram profile link (user can click message button from there)
          // Alternative: https://www.instagram.com/direct/t/${cleanValue}/ but requires login
          return `https://www.instagram.com/${cleanValue}/`;
        case 'twitter':
          // Twitter/X profile link (user can click message button from there)
          // Alternative direct message: https://twitter.com/messages/compose?screen_name=${cleanValue}
          return `https://twitter.com/${cleanValue}`;
        case 'mail':
        case 'email':
          // Mailto link - opens default email client
          return `mailto:${cleanValue}`;
        default:
          return null;
      }
    }

    // Get contact link
    const contactLink = getContactLink(formData.contactType, formData.contactValue);
    const contactButtonText = formData.contactType === 'mail' || formData.contactType === 'email' 
      ? '📧 Enviar Email' 
      : formData.contactType === 'instagram' 
      ? '📷 Abrir Instagram' 
      : '🐦 Abrir Twitter/X';

    // Organize images by category from Cloudinary URLs (already uploaded from frontend)
    const imageCategories = {
      'pose-imagen': [],
      'outfit-imagen': [],
      'referencias-imagen': []
    };
    
    // Process image URLs from request (already uploaded to Cloudinary)
    for (const fieldName of Object.keys(imageCategories)) {
      if (imageUrls[fieldName] && Array.isArray(imageUrls[fieldName])) {
        imageCategories[fieldName] = imageUrls[fieldName].map(img => ({
          url: img.url || img.secure_url, // HTTPS URL for display
          publicUrl: img.publicUrl || img.url, // Public URL for clicking
          filename: img.filename || img.publicId || 'image',
          isCloudinary: true,
          width: img.width,
          height: img.height,
          size: img.bytes
        }));
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
    .contact-buttons {
      margin-top: 10px;
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    .contact-button {
      display: inline-block;
      padding: 10px 20px;
      border-radius: 20px;
      text-decoration: none;
      font-weight: 600;
      font-size: 14px;
      color: white;
      transition: all 0.3s ease;
      border: none;
      cursor: pointer;
    }
    .contact-button:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    }
    .contact-button.instagram {
      background: linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%);
    }
    .contact-button.twitter {
      background: #1DA1F2;
    }
    .contact-button.mail {
      background: linear-gradient(135deg, #ec4078 0%, #ff6b9d 100%);
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>♥ New ${formData.tipo} Commission Request ♥</h1>
  </div>
  <div class="content">
    <div class="field">
      <span class="field-label">Name:</span>
      <div class="field-value">${formData.nombre}</div>
    </div>

    <div class="field">
      <span class="field-label">Contact:</span>
      <div class="field-value">
        ${formData.contactType}: ${formData.contactValue}
        ${contactLink ? `
        <div class="contact-buttons">
          <a href="${contactLink}" target="_blank" rel="noopener noreferrer" class="contact-button ${formData.contactType.toLowerCase()}">
            ${contactButtonText}
          </a>
        </div>
        ` : ''}
      </div>
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

    // Email configuration from environment variables
    // RESEND_FROM_EMAIL: Email del remitente usando tu dominio verificado (ej: "noreply@tudominio.com")
    // RECIPIENT_EMAIL: Email donde recibirás las solicitudes (puede ser cualquier email)
    const fromEmail = process.env.RESEND_FROM_EMAIL || 'Commission Form <noreply@tudominio.com>';
    const recipientEmail = process.env.RECIPIENT_EMAIL;
    
    // Validate required environment variables
    if (!recipientEmail) {
      throw new Error('RECIPIENT_EMAIL environment variable is not set');
    }
    
    // Check if using Resend template (set RESEND_TEMPLATE_ID in environment variables)
    const templateId = process.env.RESEND_TEMPLATE_ID;
    
    let emailResponse;
    
    if (templateId) {
      // Use Resend template with variables
      emailResponse = await resend.emails.send({
        from: fromEmail,
        to: recipientEmail,
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
        }
      });
    } else {
      // Send email with custom HTML (images from Cloudinary URLs)
      emailResponse = await resend.emails.send({
        from: fromEmail,
        to: recipientEmail,
        subject: `New ${formData.tipo} Commission Request`,
        html: htmlContent
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
    
    // Safely extract error message
    let errorMessage = 'Unknown error';
    if (error instanceof Error) {
      errorMessage = error.message;
    } else if (typeof error === 'string') {
      errorMessage = error;
    } else if (error?.message) {
      errorMessage = error.message;
    }
    
    // Log full error for debugging
    console.error('Full error object:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
    
    return res.status(500).json({ 
      error: 'Failed to send email',
      details: errorMessage 
    });
  }
}
