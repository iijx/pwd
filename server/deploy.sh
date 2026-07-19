#!/bin/bash
set -e

echo "🚀 Deploying Password Vision Backend..."

# 如果你使用的是 Git 部署，请取消注释下一行来自动拉取代码
# git pull origin main

# 1. 检查是否存在 .env 文件
if [ ! -f .env ]; then
  echo "⚠️  .env file not found! Copying from .env.example..."
  cp .env.example .env
  echo "🛑 PLEASE edit .env file to set a secure JWT_SECRET before restarting."
  exit 1
fi

echo "📦 Installing backend dependencies..."
bun install

echo "🔄 Restarting backend service with pm2..."
# 检查 pm2 是否全局安装
if ! command -v pm2 &> /dev/null; then
    echo "⚠️ pm2 is not installed. Installing pm2 globally..."
    bun add -g pm2
fi

# 如果 pwd 已经在 pm2 列表中则重启，否则新建
if pm2 describe pwd > /dev/null 2>&1; then
  # 注意：如果之前是从根目录启动的 pm2，你可能需要先手动 pm2 delete pwd，再重新运行此脚本
  pm2 restart pwd
else
  echo "Starting new pm2 instance..."
  # pm2 默认会加载当前目录的 .env 文件
  pm2 start bun --name "pwd" -- index.ts
  pm2 save
fi

echo "✅ Deployment complete!"
