#!/bin/bash

# Update and Install Essentials
apt-get update
apt-get install -y git curl nginx certbot python3-certbot-nginx

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Install Global Tools
npm install -g pm2

# Setup Project Directory
mkdir -p /root/ssactivewearorder
cd /root/ssactivewearorder

# Clone if empty (First time setup)
if [ ! -d ".git" ]; then
  git clone git@github.com:Growth-Sheriff/ssactivewearorder.git .
fi

# Pull latest
git pull origin main

# Install Dependencies
npm install
npx prisma generate
npm run build

# Setup Nginx Proxy
cat > /etc/nginx/sites-available/ssactiveorder <<EOF
server {
    server_name ssaw-e.techifyboost.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF

ln -sf /etc/nginx/sites-available/ssactiveorder /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Test Nginx and Restart
nginx -t && systemctl restart nginx

# Setup SSL
certbot --nginx -d ssaw-e.techifyboost.com --non-interactive --agree-tos -m admin@techifyboost.com

# Start App
pm2 delete ssactiveorder || true
pm2 start npm --name "ssactiveorder" -- run start
pm2 save
