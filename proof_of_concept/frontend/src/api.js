import axios from 'axios';

const API_URL = 'http://localhost:3001'; // backend moet CORS toestaan

export const fetchLatestSensorData = async () => {
  const res = await axios.get(`${API_URL}/latest`);
  return res.data;
};
