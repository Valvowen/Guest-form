const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const PROPERTY = "C. W. A. Mozart, 223, 03189 Orihuela, Alicante, España";

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function fmtDate(d) {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}

async function buildPdf(data) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 595.28; // A4
  const pageHeight = 841.89;
  const margin = 50;
  let page = doc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const seaDeep = rgb(0.09, 0.26, 0.36);
  const ink = rgb(0.11, 0.15, 0.14);
  const inkSoft = rgb(0.35, 0.4, 0.37);

  function ensureSpace(needed) {
    if (y - needed < margin) {
      page = doc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }
  }

  function heading(text, size = 18) {
    ensureSpace(size + 10);
    page.drawText(text, { x: margin, y, size, font: bold, color: seaDeep });
    y -= size + 10;
  }

  function subheading(text) {
    ensureSpace(20);
    page.drawText(text, { x: margin, y, size: 13, font: bold, color: seaDeep });
    y -= 18;
  }

  function row(label, value) {
    ensureSpace(16);
    page.drawText(label, { x: margin, y, size: 10, font, color: inkSoft });
    const valueText = value || '—';
    const valueWidth = font.widthOfTextAtSize(valueText, 10);
    page.drawText(valueText, {
      x: pageWidth - margin - valueWidth,
      y,
      size: 10,
      font: bold,
      color: ink,
    });
    y -= 15;
  }

  function divider() {
    ensureSpace(10);
    page.drawLine({
      start: { x: margin, y },
      end: { x: pageWidth - margin, y },
      thickness: 0.5,
      color: rgb(0.85, 0.84, 0.8),
    });
    y -= 12;
  }

  heading('Parte de Viajeros · Guest Registration');
  page.drawText('Registro de Viajeros · Orihuela, Alicante', {
    x: margin, y, size: 9, font, color: inkSoft,
  });
  y -= 22;

  subheading('Stay details');
  row('Property', PROPERTY);
  row('Check-in', fmtDate(data.checkin));
  row('Check-out', fmtDate(data.checkout));
  row('Number of travellers', String((data.travellers || []).length));
  y -= 8;
  divider();

  for (let i = 0; i < (data.travellers || []).length; i++) {
    const t = data.travellers[i];
    ensureSpace(140);
    subheading(`Traveller ${i + 1}: ${t.name || '—'}`);
    row('Document type', t.docType);
    row('Document number', t.docNum);
    if (t.support) row('Support number', t.support);
    row('Nationality', t.nationality);
    row('Date of birth', fmtDate(t.dob));
    row('Sex', t.sex);
    if (t.phone) row('Phone', t.phone);
    if (t.email) row('Email', t.email);
    row('Home address', t.address);
    if (t.relationship) row('Relationship (minor)', t.relationship);

    y -= 4;
    ensureSpace(70);
    page.drawText('Signature:', { x: margin, y, size: 9, font, color: inkSoft });
    y -= 12;

    if (t.signature) {
      try {
        const base64 = t.signature.split(',')[1];
        const bytes = Buffer.from(base64, 'base64');
        const png = await doc.embedPng(bytes);
        const sigW = 150;
        const sigH = (png.height / png.width) * sigW;
        ensureSpace(sigH + 10);
        page.drawImage(png, { x: margin, y: y - sigH, width: sigW, height: sigH });
        y -= sigH + 14;
      } catch (e) {
        page.drawText('(signature could not be rendered)', { x: margin, y, size: 9, font, color: inkSoft });
        y -= 16;
      }
    } else {
      page.drawText('Not signed', { x: margin, y, size: 9, font, color: rgb(0.69, 0.26, 0.18) });
      y -= 16;
    }

    y -= 10;
    divider();
  }

  return doc.save();
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: 'Method not allowed' };
  }

  try {
    const data = JSON.parse(event.body);

    if (!data.checkin || !data.checkout || !Array.isArray(data.travellers) || data.travellers.length === 0) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        body: JSON.stringify({ error: 'Missing required fields' }),
      };
    }

    const pdfBytes = await buildPdf(data);
    const pdfBase64 = Buffer.from(pdfBytes).toString('base64');

    const leadName = data.travellers[0].name || 'Guest';

    const resendResp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Guest Form <onboarding@resend.dev>',
        to: [process.env.HOST_EMAIL],
        subject: `New guest registration: ${leadName} (${fmtDate(data.checkin)} – ${fmtDate(data.checkout)})`,
        html: `<p>A new Parte de Viajeros submission has come in.</p>
               <p><strong>Property:</strong> ${PROPERTY}<br/>
               <strong>Check-in:</strong> ${fmtDate(data.checkin)}<br/>
               <strong>Check-out:</strong> ${fmtDate(data.checkout)}<br/>
               <strong>Travellers:</strong> ${data.travellers.length}</p>
               <p>Full details are in the attached PDF.</p>`,
        attachments: [
          {
            filename: `parte-de-viajeros-${leadName.replace(/\s+/g, '-').toLowerCase()}.pdf`,
            content: pdfBase64,
          },
        ],
      }),
    });

    if (!resendResp.ok) {
      const errText = await resendResp.text();
      return {
        statusCode: 502,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        body: JSON.stringify({ error: 'Email send failed', detail: errText }),
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      body: JSON.stringify({ ok: true }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      body: JSON.stringify({ error: 'Server error', detail: String(err) }),
    };
  }
};
