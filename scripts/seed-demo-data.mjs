/**
 * Seeds demo/dummy data into a fresh Engage CRM database.
 * Run AFTER seed-admin.mjs so the org + admin profile exist.
 *
 * Usage: node --env-file=.env scripts/seed-demo-data.mjs
 */
import { createClient } from '@supabase/supabase-js';

const ORG_ID = 'a0000000-0000-4000-8000-000000000001';

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const sb = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ── Customers ──────────────────────────────────────────────
const customers = [
  { name: 'Rajesh Sharma', email: 'rajesh.sharma@example.com', phone: '919876543210', company: 'Sharma Enterprises', metadata: { location: 'Mumbai' } },
  { name: 'Priya Patel', email: 'priya.patel@example.com', phone: '919876543211', company: 'Patel Industries', metadata: { location: 'Ahmedabad' } },
  { name: 'Amit Kumar', email: 'amit.kumar@example.com', phone: '919876543212', company: 'Kumar Electricals', metadata: { location: 'Delhi' } },
  { name: 'Sneha Deshmukh', email: 'sneha.d@example.com', phone: '919876543213', company: 'Deshmukh Power Solutions', metadata: { location: 'Pune' } },
  { name: 'Vikram Singh', email: 'vikram.s@example.com', phone: '919876543214', company: 'Singh Solar Works', metadata: { location: 'Jaipur' } },
  { name: 'Anjali Mehta', email: 'anjali.m@example.com', phone: '919876543215', company: 'Mehta Traders', metadata: { location: 'Surat' } },
  { name: 'Suresh Reddy', email: 'suresh.r@example.com', phone: '919876543216', company: 'Reddy Power Systems', metadata: { location: 'Hyderabad' } },
  { name: 'Deepika Joshi', email: 'deepika.j@example.com', phone: '919876543217', company: 'Joshi Infrastructure', metadata: { location: 'Bangalore' } },
  { name: 'Manoj Gupta', email: 'manoj.g@example.com', phone: '919876543218', company: 'Gupta Electronics', metadata: { location: 'Lucknow' } },
  { name: 'Kavita Nair', email: 'kavita.n@example.com', phone: '919876543219', company: 'Nair Energy Pvt Ltd', metadata: { location: 'Chennai' } },
];

// ── Products ───────────────────────────────────────────────
const products = [
  { sku: 'INV-1KVA-HF', name: '1 KVA High Frequency Inverter', category: 'Inverter', price_label: '₹8,500', description: 'Compact 1 KVA pure sine wave inverter for home use.', is_active: true, stock_status: 'In Stock' },
  { sku: 'INV-3KVA-HF', name: '3 KVA High Frequency Inverter', category: 'Inverter', price_label: '₹18,000', description: '3 KVA DSP sine wave inverter with LCD display.', is_active: true, stock_status: 'In Stock' },
  { sku: 'INV-5KVA-HF', name: '5 KVA High Frequency Inverter', category: 'Inverter', price_label: '₹28,000', description: '5 KVA pure sine wave inverter for commercial use.', is_active: true, stock_status: 'In Stock' },
  { sku: 'SOL-3KW-ONG', name: '3 KW On-Grid Solar Inverter', category: 'Solar', price_label: '₹45,000', description: '3 KW grid-tie solar inverter with MPPT.', is_active: true, stock_status: 'In Stock' },
  { sku: 'SOL-5KW-ONG', name: '5 KW On-Grid Solar Inverter', category: 'Solar', price_label: '₹65,000', description: '5 KW on-grid solar inverter with WiFi monitoring.', is_active: true, stock_status: 'In Stock' },
  { sku: 'SOL-10KW-HYB', name: '10 KW Hybrid Solar Inverter', category: 'Solar', price_label: '₹1,20,000', description: '10 KW hybrid solar inverter with battery backup.', is_active: true, stock_status: 'In Stock' },
  { sku: 'UPS-1KVA-OL', name: '1 KVA Online UPS', category: 'UPS', price_label: '₹12,000', description: '1 KVA true online double conversion UPS.', is_active: true, stock_status: 'In Stock' },
  { sku: 'UPS-3KVA-OL', name: '3 KVA Online UPS', category: 'UPS', price_label: '₹32,000', description: '3 KVA online UPS for server room protection.', is_active: true, stock_status: 'In Stock' },
  { sku: 'UPS-10KVA-OL', name: '10 KVA Online UPS', category: 'UPS', price_label: '₹85,000', description: '10 KVA 3-phase online UPS for industrial use.', is_active: true, stock_status: 'In Stock' },
  { sku: 'BAT-150AH-TUB', name: '150 Ah Tubular Battery', category: 'Battery', price_label: '₹14,500', description: '150 Ah C20 tubular battery, 5-year warranty.', is_active: true, stock_status: 'In Stock' },
  { sku: 'BAT-200AH-TUB', name: '200 Ah Tubular Battery', category: 'Battery', price_label: '₹18,000', description: '200 Ah tall tubular battery for heavy duty.', is_active: true, stock_status: 'In Stock' },
  { sku: 'STAB-5KVA', name: '5 KVA Voltage Stabilizer', category: 'Stabilizer', price_label: '₹6,500', description: '5 KVA servo voltage stabilizer for AC.', is_active: true, stock_status: 'In Stock' },
];

// ── Leads ──────────────────────────────────────────────────
const statuses = ['New', 'Contacted', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'];
const sources = ['Website', 'WhatsApp', 'IndiaMART', 'Referral', 'TradeIndia', 'Walk-in'];
const priorities = ['High', 'Medium', 'Low'];
const salesPersons = ['Ritesh Patil', 'Amol Jadhav', 'Saibal Das'];

const leads = [
  { name: 'Rohit Agarwal', email: 'rohit.a@example.com', phone: '919812345001', company: 'Agarwal Steel Works', location: 'Nagpur', requirement: '10 KVA UPS for factory', status: 'Qualified', priority: 'High', source: 'website', sales_person: 'Ritesh Patil' },
  { name: 'Meena Kapoor', email: 'meena.k@example.com', phone: '919812345002', company: 'Kapoor Textiles', location: 'Surat', requirement: '5 KW Solar system for warehouse', status: 'Proposal', priority: 'High', source: 'whatsapp', sales_person: 'Amol Jadhav' },
  { name: 'Arjun Verma', email: 'arjun.v@example.com', phone: '919812345003', company: 'Verma IT Solutions', location: 'Bangalore', requirement: '3 KVA Online UPS for server room', status: 'New', priority: 'Medium', source: 'website', sales_person: 'Saibal Das' },
  { name: 'Sunita Rao', email: 'sunita.r@example.com', phone: '919812345004', company: 'Rao Pharmaceuticals', location: 'Hyderabad', requirement: '20 KVA UPS system', status: 'Contacted', priority: 'High', source: 'email', sales_person: 'Ritesh Patil' },
  { name: 'Prakash Jain', email: 'prakash.j@example.com', phone: '919812345005', company: 'Jain Cold Storage', location: 'Indore', requirement: '10 KW Hybrid Solar for cold storage', status: 'Negotiation', priority: 'High', source: 'whatsapp', sales_person: 'Amol Jadhav' },
  { name: 'Nisha Tiwari', email: 'nisha.t@example.com', phone: '919812345006', company: 'Tiwari Hospital', location: 'Bhopal', requirement: '5 KVA UPS for medical equipment', status: 'Qualified', priority: 'Medium', source: 'website', sales_person: 'Saibal Das' },
  { name: 'Kiran Desai', email: 'kiran.d@example.com', phone: '919812345007', company: 'Desai Farms', location: 'Nashik', requirement: '3 KW Solar for farm pump', status: 'Won', priority: 'Medium', source: 'whatsapp', sales_person: 'Ritesh Patil' },
  { name: 'Ravi Malhotra', email: 'ravi.m@example.com', phone: '919812345008', company: 'Malhotra Hotels', location: 'Goa', requirement: '50 KVA UPS + Stabilizer for hotel', status: 'Proposal', priority: 'High', source: 'whatsapp', sales_person: 'Amol Jadhav' },
  { name: 'Pooja Saxena', email: 'pooja.s@example.com', phone: '919812345009', company: 'Saxena Retail', location: 'Lucknow', requirement: '1 KVA inverter + 150 Ah battery', status: 'Contacted', priority: 'Low', source: 'website', sales_person: 'Saibal Das' },
  { name: 'Manish Bhatia', email: 'manish.b@example.com', phone: '919812345010', company: 'Bhatia Constructions', location: 'Chandigarh', requirement: 'Bulk batteries 200 Ah x 20 units', status: 'New', priority: 'Medium', source: 'email', sales_person: 'Ritesh Patil' },
  { name: 'Divya Pillai', email: 'divya.p@example.com', phone: '919812345011', company: 'Pillai Supermarket', location: 'Kochi', requirement: '5 KVA stabilizer for refrigeration', status: 'Qualified', priority: 'Low', source: 'website', sales_person: 'Amol Jadhav' },
  { name: 'Sanjay Thakur', email: 'sanjay.t@example.com', phone: '919812345012', company: 'Thakur Petrol Pump', location: 'Pune', requirement: '10 KW Solar + UPS combo', status: 'Negotiation', priority: 'High', source: 'whatsapp', sales_person: 'Saibal Das' },
  { name: 'Aarti Shah', email: 'aarti.s@example.com', phone: '919812345013', company: 'Shah Jewellers', location: 'Mumbai', requirement: '3 KVA UPS for showroom', status: 'Lost', priority: 'Low', source: 'website', sales_person: 'Ritesh Patil' },
  { name: 'Nitin Chandra', email: 'nitin.c@example.com', phone: '919812345014', company: 'Chandra Dairy', location: 'Jaipur', requirement: '5 KW Solar for dairy plant', status: 'Won', priority: 'Medium', source: 'whatsapp', sales_person: 'Amol Jadhav' },
  { name: 'Rekha Pandey', email: 'rekha.p@example.com', phone: '919812345015', company: 'Pandey School', location: 'Varanasi', requirement: '3 KVA inverter + batteries for school', status: 'New', priority: 'Medium', source: 'website', sales_person: 'Saibal Das' },
];

// ── Seed runner ────────────────────────────────────────────
async function seed() {
  console.log('Seeding demo data...\n');

  // Customers
  const custRows = customers.map((c) => ({ org_id: ORG_ID, ...c }));
  const { error: custErr, data: custData } = await sb.from('customers').insert(custRows).select('id, name');
  if (custErr) {
    if (custErr.message.includes('duplicate')) console.log('Customers: already seeded (skipped)');
    else console.error('Customers error:', custErr.message);
  } else console.log(`Customers: ${custData.length} seeded`);

  // Products
  const prodRows = products.map((p) => ({ org_id: ORG_ID, ...p }));
  const { error: prodErr, data: prodData } = await sb.from('products').upsert(prodRows, { onConflict: 'org_id,sku', ignoreDuplicates: true }).select('id, name');
  if (prodErr) console.error('Products error:', prodErr.message);
  else console.log(`Products: ${prodData.length} seeded`);

  // Leads
  const leadRows = leads.map((l) => ({
    org_id: ORG_ID,
    name: l.name,
    email: l.email,
    phone: l.phone,
    company: l.company,
    location: l.location,
    requirement: l.requirement,
    status: l.status,
    priority: l.priority,
    source: l.source,
    sales_person: l.sales_person,
    tags: [],
  }));
  const { error: leadErr, data: leadData } = await sb.from('leads').insert(leadRows).select('id, name');
  if (leadErr) {
    if (leadErr.message.includes('duplicate')) {
      console.log('Leads: already seeded (skipped duplicates)');
    } else {
      console.error('Leads error:', leadErr.message);
    }
  } else {
    console.log(`Leads: ${leadData.length} seeded`);
  }

  console.log('\nDone! Login and check Dashboard, Customers, Products, Leads, Pipeline.');
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
