npm run build
rm /var/www/SyncPath/* -Rf
cp dist/* /var/www/SyncPath/ -Rfv
