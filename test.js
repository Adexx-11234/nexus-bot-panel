import express from 'express';
import fs from 'fs';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

app.post('/save-cookies', (req, res) => {
    const { cookies } = req.body;
    
    let netscapeCookies = '# Netscape HTTP Cookie File\n';
    
    Object.entries(cookies).forEach(([name, value]) => {
        const expiry = Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60);
        netscapeCookies += `.youtube.com\tTRUE\t/\tTRUE\t${expiry}\t${name}\t${value}\n`;
    });
    
    fs.writeFileSync('./youtube_cookies.txt', netscapeCookies);
    res.json({ success: true, message: 'Cookies saved!' });
});

app.listen(3000, () => console.log('Server running on http://localhost:3000'));