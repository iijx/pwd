#!/bin/bash
set -e

echo "🚀 Deploying Password Vision..."

# 如果你使用的是 Git 部署，请取消注释下一行来自动拉取代码
# git pull origin main

# 1. 检查是否存在 server/.env 文件
if [ ! -f server/.env ]; then
  echo "⚠️  server/.env file not found! Copying from server/.env.example..."
  cp server/.env.example server/.env
  echo "🛑 PLEASE edit server/.env file to set a secure JWT_SECRET before restarting."
  exit 1
fi

echo "📦 Installing backend dependencies..."
(cd server && bun install)

echo "🔄 Restarting backend service with pm2..."
# 检查 pm2 是否全局安装
if ! command -v pm2 &> /dev/null; then
    echo "⚠️ pm2 is not installed. Installing pm2 globally..."
    bun add -g pm2
fi

# 如果 pwd 已经在 pm2 列表中则重启，否则新建
if pm2 describe pwd > /dev/null 2>&1; then
  # 注意：如果之前是从根目录启动的 pm2，你可能需要先手动 pm2 delete pwd，再重新运行此脚本，以便在 server 目录下正确加载 .env
  pm2 restart pwd
else
  echo "Starting new pm2 instance..."
  # pm2 默认会加载当前目录的 .env 文件，所以进入 server 目录启动
  (cd server && pm2 start index.ts --name "pwd" --interpreter ~/.bun/bin/bun)
  pm2 save
fi

echo "✅ Deployment complete!"
