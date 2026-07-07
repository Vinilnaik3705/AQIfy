export default async function handler(req, res) {
  const { city = 'all' } = req.query;
  
  const RENDER_API = 'https://aqify.onrender.com';
  
  try {
    const response = await fetch(`${RENDER_API}/api/state?city=${city}`);
    const data = await response.json();
    
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    res.status(response.status).json(data);
  } catch (error) {
    console.error('Error fetching from Render:', error);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(500).json({ error: 'Failed to fetch data from backend' });
  }
}
