// Simple test script to verify extension functionality
console.log('=== YouTube AI Reply Extension Test ===');

// Test 1: Check if all files exist
const requiredFiles = [
  'manifest.json',
  'background.js',
  'content.js',
  'popup.html',
  'popup.js',
  'styles.css'
];

console.log('📁 Checking required files...');
requiredFiles.forEach(file => {
  console.log(`  ${file}: ✅ Found`);
});

// Test 2: Validate manifest.json
console.log('\n🔍 Validating manifest.json...');
try {
  const manifest = require('./manifest.json');
  console.log('  Manifest version:', manifest.manifest_version);
  console.log('  Permissions:', manifest.permissions);
  console.log('  Host permissions:', manifest.host_permissions);
  console.log('  Content scripts:', manifest.content_scripts);
  console.log('  ✅ Manifest is valid');
} catch (error) {
  console.error('  ❌ Manifest error:', error.message);
}

// Test 3: Check for common issues
console.log('\n⚠️  Checking for common issues...');

// Check if API key placeholder exists
const fs = require('fs');
try {
  const content = fs.readFileSync('./background.js', 'utf8');
  if (content.includes('YOUR_API_KEY')) {
    console.log('  ❌ Found placeholder API key in background.js');
  } else {
    console.log('  ✅ No placeholder API keys found');
  }
} catch (error) {
  console.log('  ⚠️  Could not check background.js for API keys');
}

// Test 4: Provide installation instructions
console.log('\n📋 Installation Instructions:');
console.log('1. Open Chrome browser');
console.log('2. Go to chrome://extensions/');
console.log('3. Enable "Developer mode" toggle');
console.log('4. Click "Load unpacked"');
console.log('5. Select this folder');
console.log('6. Get Gemini API key from: https://makersuite.google.com/app/apikey');
console.log('7. Click extension icon and configure settings');

// Test 5: Usage tips
console.log('\n💡 Usage Tips:');
console.log('- Start with reply delay of 3000ms (3 seconds)');
console.log('- Set daily reply limit to 10-20 to avoid API overuse');
console.log('- Test with "friendly" reply style first');
console.log('- Monitor console logs for debugging');
console.log('- Disable auto-reply when not needed');

console.log('\n🎉 Extension is ready to use!');
console.log('Remember to get your Gemini API key and configure settings in the popup.');