const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const client = new S3Client({
  region: 'auto',
  endpoint: 'https://3b964e63af3f0e752c640e35dab68c9b.r2.cloudflarestorage.com',
  credentials: {
    accessKeyId: '407a988b60e3771bc982048523562047',
    secretAccessKey: 'e343c33e70b5c0ba965b4d7d4d5605693239122f704d1d219a4fec860cf7384b'
  }
});

async function uploadTest() {
  try {
    await client.send(new PutObjectCommand({
      Bucket: 'ssactivewearorder',
      Key: 'test.txt',
      Body: 'Hello from SSActiveWear App - R2 Test Upload Success!',
      ContentType: 'text/plain'
    }));
    console.log('✅ Upload successful!');
    console.log('Test URL: https://img-ssa-e.techifyboost.com/test.txt');
  } catch (error) {
    console.error('❌ Upload failed:', error.message);
  }
}

uploadTest();
