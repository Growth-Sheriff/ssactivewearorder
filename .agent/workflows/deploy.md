---
description: Deploy changes to production server via Git
---

# Deployment Workflow

**Strict Rule**: NEVER use `scp` or direct file transfer to the server. ALL code changes must go through Git.

## 1. Commit and Push Local Changes
Ensure all local changes are committed and pushed to the remote repository.
```powershell
git add .
git commit -m "Update code"
git push origin main
```

## 2. Connect to Server and Pull
Connect to the server using the strict SSH command and pull the changes.

```powershell
ssh -i $env:USERPROFILE\.ssh\ssactivewearorder root@5.78.132.44 "cd /root/ssactivewearorder && git pull origin main && npm install && npm run build && pm2 restart all"
```
*(Note: Adjust the server path `/root/ssactivewearorder` and build commands as the project structure evolves, but keep the SSH connection method constant.)*
