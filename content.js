// Content script for YouTube comment detection and reply
class YouTubeCommentMonitor {
  constructor() {
    this.observer = null;
    this.processedComments = new Set();
    this.recentlyProcessed = new Set(); // For preventing rapid duplicate processing
    this.replyQueue = [];
    this.isProcessing = false;
    this.settings = null;
    this.lastProcessedTexts = new Map(); // Track recently processed texts by position
    
    this.init();
  }

  async init() {
    console.log('YouTube AI Reply content script loaded');
    
    // Wait for settings to load
    const settingsLoaded = await this.loadSettings();
    if (!settingsLoaded) {
      console.log('Settings failed to load, retrying in 2 seconds...');
      setTimeout(async () => {
        await this.loadSettings();
        this.startCommentMonitoring();
      }, 2000);
    } else {
      // Start monitoring for comments
      this.startCommentMonitoring();
    }
    
    // Listen for settings changes
    this.listenForSettingsChanges();
  }

  async loadSettings() {
    try {
      console.log('Loading settings...');
      const response = await chrome.runtime.sendMessage({ action: 'getSettings' });
      if (response && response.success) {
        this.settings = response.settings;
        console.log('Settings loaded:', this.settings);
        return true;
      } else {
        console.log('Failed to load settings, using defaults');
        // Set default settings
        this.settings = {
          autoReplyEnabled: false,
          apiKey: '',
          replyDelay: 3000,
          replyStyle: 'friendly',
          maxRepliesPerSession: 10
        };
        return false;
      }
    } catch (error) {
      console.error('Error loading settings:', error);
      // Set default settings
      this.settings = {
        autoReplyEnabled: false,
        apiKey: '',
        replyDelay: 3000,
        replyStyle: 'friendly',
        maxRepliesPerSession: 10
      };
      return false;
    }
  }

  listenForSettingsChanges() {
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace === 'sync' && changes.settings) {
        this.settings = changes.settings.newValue;
        console.log('Settings updated:', this.settings);
      }
    });
  }

  startCommentMonitoring() {
    // Wait for comments section to load
    const waitForComments = () => {
      // Try multiple selectors for comments section
      const commentsSection = document.querySelector('#comments') || 
                             document.querySelector('#comments-section') ||
                             document.querySelector('ytcp-comments-section') ||
                             document.querySelector('.comments-section');
      
      if (commentsSection) {
        this.setupCommentObserver();
        // processExistingComments is now called in setupCommentObserver
      } else {
        console.log('Waiting for comments section to load...');
        setTimeout(waitForComments, 1000);
      }
    };

    waitForComments();
  }

  setupCommentObserver() {
    // Try multiple selectors for comments section
    const commentsSection = document.querySelector('#comments') || 
                           document.querySelector('#comments-section') ||
                           document.querySelector('ytcp-comments-section') ||
                           document.querySelector('.comments-section');
    
    if (!commentsSection) {
      console.log('Comments section not found, retrying in 1 second...');
      setTimeout(() => this.setupCommentObserver(), 1000);
      return;
    }

    this.observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Skip UI elements that can't contain comments
            const tagName = node.tagName.toLowerCase();
            const skipTags = [
              'tp-yt-paper-ripple', 'yt-icon-button', 'svg', 'path', 'circle', 'button', 
              'ytcp-comment-button', 'ytcp-tooltip', 'ytcp-img-with-fallback', 'ytcp-icon-button',
              'tp-yt-iron-icon', 'dom-if', 'ytcp-comment-video-thumbnail'
            ];
            if (skipTags.includes(tagName)) {
              return;
            }
            
            // Look specifically for comment text elements
            if (node.id === 'content-text' || node.classList.contains('yt-core-attributed-string')) {
              const text = node.textContent || '';
              // Skip if this looks like our own reply or UI text
              if (text.trim().length > 10 && 
                  !text.includes('Reply') && 
                  !text.includes('Share') &&
                  !this.isOwnReply(text)) {
                console.log('Found comment text:', text.substring(0, 50) + '...');
                this.processNewComment(node);
              }
            } else {
              // Look for comment text within the added node
              const commentTexts = node.querySelectorAll('#content-text, .yt-core-attributed-string');
              commentTexts.forEach(comment => {
                const text = comment.textContent || '';
                // Skip if this looks like our own reply or UI text
                if (text.trim().length > 10 && 
                    !text.includes('Reply') && 
                    !text.includes('Share') &&
                    !this.isOwnReply(text)) {
                  console.log('Found comment text in container:', text.substring(0, 50) + '...');
                  this.processNewComment(comment);
                }
              });
            }
          }
        });
      });
    });

    this.observer.observe(commentsSection, {
      childList: true,
      subtree: true,
      attributes: false,
      characterData: false
    });

    console.log('Comment observer started');
    // Process existing comments
    this.processExistingComments();
  }

  isCommentElement(element) {
    if (element.nodeType !== Node.ELEMENT_NODE) return false;
    
    // Skip all YouTube Studio components and UI elements
    const tagName = element.tagName.toLowerCase();
    const skipTags = [
      'tp-yt-paper-ripple', 'yt-icon-button', 'svg', 'path', 'circle', 'button', 
      'ytcp-comment-button', 'ytcp-tooltip', 'ytcp-img-with-fallback', 'ytcp-icon-button',
      'tp-yt-iron-icon', 'dom-if', 'ytcp-comment-video-thumbnail'
    ];
    if (skipTags.includes(tagName)) {
      return false;
    }
    
    // Skip elements with these class names
    if (element.className && (
        element.className.includes('style-scope ytcp-') ||
        element.className.includes('video-thumbnail') ||
        element.className.includes('icon-button')
    )) {
      return false;
    }
    
    // Only log for elements that might actually be comments
    if ((element.id && element.id.includes('comment')) || 
        (element.className && element.className.includes('comment'))) {
      console.log('Checking if element is comment:', element.tagName, element.id, element.className);
    }
    
    // Only accept elements that are actual comment text
    if (element.id === 'content-text' || element.classList.contains('yt-core-attributed-string')) {
      const text = element.textContent || '';
      return text.trim().length > 10 && !text.includes('Reply') && !text.includes('Share');
    }
    
    // For containers, check if they contain comment text
    const commentText = element.querySelector('#content-text, .yt-core-attributed-string');
    if (commentText) {
      const text = commentText.textContent || '';
      return text.trim().length > 10 && !text.includes('Reply') && !text.includes('Share');
    }
    
    return false;
  }

  processExistingComments() {
    try {
      console.log('Processing existing comments...');
      const existingComments = document.querySelectorAll('ytd-comment-thread-renderer #content-text, ytd-comment-renderer #content-text, ytcp-comment #content-text, #content-text.yt-core-attributed-string');
      console.log('Found', existingComments.length, 'existing comments');
      existingComments.forEach(comment => {
        // Only process if this looks like actual comment text and not our own reply
        const text = comment.textContent || '';
        if (text.trim().length > 10 && !this.isOwnReply(text)) {
          this.processNewComment(comment);
        }
      });
    } catch (error) {
      console.error('Error processing existing comments:', error);
    }
  }

  async processNewComment(commentElement) {
    try {
      // Ensure settings are loaded
      if (!this.settings) {
        console.log('Settings not loaded yet, loading now...');
        await this.loadSettings();
      }
      
      console.log('Auto-reply enabled:', this.settings?.autoReplyEnabled);
      console.log('API key exists:', !!this.settings?.apiKey);
      
      if (!this.settings?.autoReplyEnabled) {
        console.log('Auto-reply is disabled in settings');
        return;
      }
      
      if (!this.settings?.apiKey) {
        console.log('API key is not configured');
        return;
      }

      // Extract comment text early for duplicate checking
      const commentText = this.extractCommentText(commentElement);
      if (!commentText || commentText.trim().length < 10) {
        return;
      }

      // Get the position of the comment for better duplicate detection
      const position = this.getElementPosition(commentElement);
      
      // Check if we've recently processed a comment with the same text at this position
      const positionKey = Math.floor(position / 100); // Group positions in 100px chunks
      const textKey = this.simpleHash(commentText.substring(0, 50));
      const recentKey = `${positionKey}_${textKey}`;
      const now = Date.now();
      
      if (this.lastProcessedTexts.has(recentKey)) {
        const lastProcessed = this.lastProcessedTexts.get(recentKey);
        if (now - lastProcessed < 10000) { // 10 second debounce for same text in similar position
          console.log('Comment recently processed at this position, skipping');
          return;
        }
      }
      
      // Update the last processed time
      this.lastProcessedTexts.set(recentKey, now);
      
      // Clean up old entries (keep only last minute)
      if (this.lastProcessedTexts.size > 100) {
        const cutoff = now - 60000;
        for (const [key, timestamp] of this.lastProcessedTexts.entries()) {
          if (timestamp < cutoff) {
            this.lastProcessedTexts.delete(key);
          }
        }
      }

      // Get comment ID to avoid duplicates
      const commentId = this.getCommentId(commentElement);
      
      // Check if we've already processed this comment
      if (this.processedComments.has(commentId)) {
        console.log(`Comment ${commentId} already processed, skipping`);
        return;
      }
      
      // Also check by text content to be extra sure
      const textHash = this.simpleHash(commentText);
      if (this.processedComments.has(`text_${textHash}`)) {
        console.log(`Comment with same text already processed, skipping`);
        return;
      }

      console.log('New comment detected:', commentText.substring(0, 100) + '...');
      
      // Add to reply queue with position info - but DON'T mark as processed yet
      this.replyQueue.push({
        commentId,
        commentText,
        element: commentElement,
        timestamp: Date.now(),
        textHash,
        position
      });

      // Sort the queue by position (top to bottom)
      this.replyQueue.sort((a, b) => a.position - b.position);

      // Process reply queue
      this.processReplyQueue();
    } catch (error) {
      console.error('Error processing new comment:', error);
      console.error('Comment element:', commentElement);
    }
  }

  getCommentId(commentElement) {
    try {
      // Extract the actual comment text first
      const commentText = this.extractCommentText(commentElement);
      if (!commentText) {
        return `error_${Date.now()}`;
      }
      
      // Try to get a unique identifier from the comment container
      const comment = commentElement.closest('#comment') || 
                     commentElement.closest('ytcp-comment') ||
                     commentElement.closest('ytd-comment-thread-renderer') ||
                     commentElement.closest('ytd-comment-renderer');
      
      if (comment) {
        // Try to get a stable ID from the comment element
        const id = comment.id ||
                  comment.getAttribute('data-comment-id') ||
                  comment.getAttribute('comment-id') ||
                  comment.getAttribute('data-id');
        
        if (id && id !== 'comment') {
          // Use the ID with a hash of the comment text
          const textHash = this.simpleHash(commentText.substring(0, 100));
          const uniqueId = `${id}_${textHash}`;
          console.log('Generated comment ID:', uniqueId);
          return uniqueId;
        }
      }
      
      // If no stable ID found, use hash of comment text
      const textHash = this.simpleHash(commentText);
      const uniqueId = `comment_${textHash}`;
      console.log('Generated hash-based comment ID:', uniqueId);
      return uniqueId;
    } catch (error) {
      console.error('Error getting comment ID:', error);
      return `error_${Date.now()}`;
    }
  }
  
  simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }
  
  getElementPosition(element) {
    // Get the Y position of the element relative to the document
    let yPos = 0;
    let tempElement = element;
    
    while (tempElement) {
      yPos += tempElement.offsetTop;
      tempElement = tempElement.offsetParent;
    }
    
    return yPos;
  }
  
  isOwnReply(text) {
    // Check if the text looks like our AI-generated reply
    const ownReplyPatterns = [
      '谢谢你的夸奖',
      '¡Gracias',
      'AI-generated reply',
      '很高兴你喜欢',
      'Me alegra que te guste',
      '感谢你的',
      'Thank you for'
    ];
    
    return ownReplyPatterns.some(pattern => text.includes(pattern));
  }

  extractCommentText(commentElement) {
    try {
      console.log('Attempting to extract comment text from element:', commentElement);
      
      // If the element itself is the content-text element, use its text directly
      if (commentElement.id === 'content-text' || commentElement.classList.contains('yt-core-attributed-string')) {
        const text = commentElement.textContent.trim();
        console.log('Extracted comment text directly:', text.substring(0, 100) + '...');
        return text;
      }
      
      // Find the comment text element using multiple selectors
      const textElement = commentElement.querySelector('#content-text') ||
                         commentElement.querySelector('.yt-core-attributed-string') ||
                         commentElement.querySelector('yt-formatted-string#content-text');
      
      if (textElement) {
        const text = textElement.textContent.trim();
        console.log('Extracted comment text from selector:', text.substring(0, 100) + '...');
        return text;
      }
      
      // If the element is yt-formatted-string with content-text id
      if (commentElement.tagName === 'YT-FORMATTED-STRING' && commentElement.id === 'content-text') {
        const text = commentElement.textContent.trim();
        console.log('Extracted comment text from yt-formatted-string:', text.substring(0, 100) + '...');
        return text;
      }
      
      // Last resort - use the element's text if it looks like a comment
      const text = commentElement.textContent.trim();
      if (text.length > 10 && !text.includes('Reply') && !text.includes('Share')) {
        console.log('Extracted comment text from element:', text.substring(0, 100) + '...');
        return text;
      }
      
    } catch (error) {
      console.error('Error extracting comment text:', error);
      console.error('Comment element for debugging:', commentElement);
    }
    return '';
  }

  async processReplyQueue() {
    if (this.isProcessing || this.replyQueue.length === 0) {
      return;
    }

    this.isProcessing = true;
    console.log(`Processing reply queue with ${this.replyQueue.length} comments`);

    while (this.replyQueue.length > 0) {
      const comment = this.replyQueue.shift();
      console.log(`Processing comment: ${comment.commentId} - ${comment.commentText.substring(0, 50)}...`);
      
      // Double check if this comment has already been processed
      if (this.processedComments.has(comment.commentId) || 
          this.processedComments.has(`text_${comment.textHash}`)) {
        console.log(`Comment ${comment.commentId} already processed, skipping`);
        continue;
      }
      
      // Mark as processed NOW - before we start replying
      this.processedComments.add(comment.commentId);
      this.processedComments.add(`text_${comment.textHash}`);
      
      // Check if we should reply to this comment
      if (await this.shouldReplyToComment(comment)) {
        await this.generateAndPostReply(comment);
      } else {
        console.log(`Skipping reply to comment: ${comment.commentId}`);
      }

      // Add delay between replies
      await this.sleep(this.settings?.replyDelay || 3000);
    }

    this.isProcessing = false;
    console.log('Reply queue processing completed');
  }

  async shouldReplyToComment(comment) {
    console.log('Checking if should reply to comment...');
    
    // Check if auto-reply is enabled
    if (!this.settings?.autoReplyEnabled) {
      console.log('Auto-reply is disabled');
      return false;
    }

    // Check reply limit
    if (this.settings?.maxRepliesPerSession) {
      const today = new Date().toDateString();
      const replyCount = await this.getTodayReplyCount();
      console.log(`Today's reply count: ${replyCount}, max: ${this.settings.maxRepliesPerSession}`);
      if (replyCount >= this.settings.maxRepliesPerSession) {
        console.log('Maximum replies reached for today');
        return false;
      }
    }

    // Avoid replying to very short comments
    if (comment.commentText.length < 10) {
      console.log('Comment too short, skipping');
      return false;
    }

    // Avoid replying to comments that might be spam
    const spamKeywords = ['subscribe', 'like', 'check out', 'visit my', 'my channel'];
    const lowerComment = comment.commentText.toLowerCase();
    if (spamKeywords.some(keyword => lowerComment.includes(keyword))) {
      console.log('Comment contains spam keywords, skipping');
      return false;
    }

    console.log('Should reply to comment: YES');
    return true;
  }

  async getTodayReplyCount() {
    return new Promise((resolve) => {
      const today = new Date().toDateString();
      chrome.storage.local.get(['replyCount'], (result) => {
        const countData = result.replyCount || {};
        resolve(countData[today] || 0);
      });
    });
  }

  async incrementReplyCount() {
    return new Promise((resolve) => {
      const today = new Date().toDateString();
      chrome.storage.local.get(['replyCount'], (result) => {
        const countData = result.replyCount || {};
        countData[today] = (countData[today] || 0) + 1;
        chrome.storage.local.set({ replyCount: countData }, resolve);
      });
    });
  }

  async generateAndPostReply(comment) {
    try {
      console.log('Generating reply for:', comment.commentText.substring(0, 50) + '...');

      // Generate AI reply
      const response = await chrome.runtime.sendMessage({
        action: 'generateReply',
        commentText: comment.commentText,
        replyStyle: this.settings?.replyStyle || 'friendly'
      });

      if (!response.success) {
        throw new Error(response.error);
      }

      const replyText = response.reply;
      console.log('Generated reply:', replyText);

      // Post the reply
      await this.postReply(comment.element, replyText);

      // Increment reply count
      await this.incrementReplyCount();

      console.log('Reply posted successfully');

    } catch (error) {
      console.error('Error generating/posting reply:', error);
    }
  }

  async postReply(commentElement, replyText) {
    try {
      console.log('Attempting to post reply...', replyText.substring(0, 50) + '...');
      
      // Find the reply button using multiple selectors
      const replyButton = this.findReplyButton(commentElement);
      
      if (!replyButton) {
        throw new Error('Reply button not found');
      }

      console.log('Found reply button, clicking...');
      replyButton.click();
      await this.sleep(2000); // Increased delay for YouTube Studio

      // Find reply input box
      const replyInput = this.findReplyInput();
      
      if (!replyInput) {
        // Try to find the reply button again and click it once more
        console.log('Reply input not found, trying to click reply button again...');
        replyButton.click();
        await this.sleep(1500);
        
        // Try to find reply input again
        const retryInput = this.findReplyInput();
        if (!retryInput) {
          throw new Error('Reply input not found after retry');
        }
        console.log('Found reply input on retry:', retryInput);
      }

      console.log('Found reply input, typing text...');
      replyInput.focus();
      await this.typeText(replyInput, replyText);

      // Find and click post button
      const postButton = this.findPostButton();
      
      if (!postButton) {
        throw new Error('Post button not found');
      }

      console.log('Found post button, clicking...');
      postButton.click();
      
      // Wait for the reply to be posted
      await this.sleep(3000);
      
      // Check if the post was successful by looking for our reply text
      const postedSuccessfully = this.checkIfReplyWasPosted(replyText);
      
      if (postedSuccessfully) {
        console.log('Reply verified as posted');
        
        // Only close the dialog if we're sure the reply was posted
        await this.sleep(1000); // Small delay before closing
        await this.closeReplyDialog();
      } else {
        console.log('Could not verify if reply was posted, attempting to close dialog anyway');
        await this.closeReplyDialog();
      }
      
      console.log('Reply posting process completed');
      return true;

    } catch (error) {
      console.error('Error posting reply:', error);
      // Try to close any open dialogs
      await this.closeReplyDialog();
      // Log additional debugging information
      console.log('Comment element for debugging:', commentElement);
      console.log('Document body for debugging:', document.body.innerHTML.substring(0, 1000));
      throw error;
    }
  }

  findReplyButton(commentElement) {
    const comment = commentElement.closest('#comment') || 
                   commentElement.closest('ytd-comment-thread-renderer') ||
                   commentElement.closest('ytd-comment-renderer') ||
                   commentElement.closest('ytcp-comment');
    
    if (!comment) {
      console.log('Comment element not found for reply button');
      return null;
    }

    console.log('Looking for reply button in comment element:', comment);
    
    // Try multiple selectors for reply button, prioritizing YouTube Studio selectors
    const replyButton = comment.querySelector('ytcp-comment-button#reply-button button') ||
                        comment.querySelector('ytcp-comment-button#reply-button') ||
                        comment.querySelector('button[aria-label*="Reply"]') ||
                        comment.querySelector('button[aria-label*="reply"]') ||
                        comment.querySelector('button[aria-label*="回复"]') ||
                        comment.querySelector('button[title*="Reply"]') ||
                        comment.querySelector('button[title*="reply"]') ||
                        comment.querySelector('button[title*="回复"]') ||
                        comment.querySelector('.ytd-comment-action-buttons-renderer button') ||
                        comment.querySelector('#reply-button-end');
    
    if (replyButton) {
      console.log('Found reply button:', replyButton);
      return replyButton;
    } else {
      console.log('Reply button not found in comment element');
      // Log the comment element for debugging
      console.log('Comment element HTML:', comment.outerHTML.substring(0, 500));
      return null;
    }
  }

  findReplyInput() {
    console.log('Looking for reply input...');
    
    // Try to find the textarea in YouTube Studio comment box
    const input = document.querySelector('ytcp-commentbox tp-yt-iron-autogrow-textarea textarea') ||
                  document.querySelector('ytcp-commentbox textarea') ||
                  document.querySelector('tp-yt-iron-autogrow-textarea textarea') ||
                  document.querySelector('#reply-dialog-id textarea') ||
                  document.querySelector('#reply-dialog-container textarea') ||
                  document.querySelector('textarea[placeholder*="回复"]') ||
                  document.querySelector('textarea[placeholder*="添加回复"]') ||
                  document.querySelector('textarea[aria-label*="添加回复"]');
    
    if (input) {
      console.log('Found reply input:', input);
      console.log('Reply input tag, id, class, placeholder:', input.tagName, input.id, input.className, input.placeholder);
      return input;
    }
    
    // Log all textareas for debugging
    const allTextareas = document.querySelectorAll('textarea');
    console.log('All textareas found:', allTextareas.length);
    allTextareas.forEach((el, index) => {
      console.log(`Textarea ${index}:`, el.tagName, el.id, el.className, el.placeholder, el.getAttribute('aria-label'));
    });
    
    // Fallback to contenteditable divs for regular YouTube
    const allEditable = document.querySelectorAll('div[contenteditable="true"]');
    console.log('All contenteditable elements found:', allEditable.length);
    
    const fallbackInput = document.querySelector('ytcp-comment-simplebox-renderer div[contenteditable="true"]') ||
                         document.querySelector('ytd-comment-simplebox-renderer div[contenteditable="true"]') ||
                         document.querySelector('div[contenteditable="true"][role="textbox"]');
    
    if (fallbackInput) {
      console.log('Found fallback reply input:', fallbackInput);
      return fallbackInput;
    }
    
    console.log('Reply input not found');
    return null;
  }

  findPostButton() {
    console.log('Looking for post button...');
    
    // Try multiple selectors for post button, updated for YouTube Studio's structure
    const postButton = document.querySelector('ytcp-comment-button#submit-button ytcp-button-shape button') ||
                      document.querySelector('ytcp-comment-button#submit-button button') ||
                      document.querySelector('#submit-button ytcp-button-shape button') ||
                      document.querySelector('#submit-button button') ||
                      document.querySelector('ytcp-commentbox #submit-button button') ||
                      document.querySelector('ytcp-commentbox button[aria-label*="回复"]') ||
                      document.querySelector('ytcp-commentbox button[aria-label*="Comment"]') ||
                      document.querySelector('ytcp-button-shape button[aria-label*="回复"]') ||
                      document.querySelector('ytcp-button-shape button[aria-label*="Comment"]') ||
                      document.querySelector('ytcp-button-shape button[aria-label*="Post"]') ||
                      document.querySelector('button[aria-label*="回复"]') ||
                      document.querySelector('button[aria-label*="Comment"]') ||
                      document.querySelector('button[aria-label*="Post"]') ||
                      document.querySelector('button[aria-label*="发布"]') ||
                      document.querySelector('button#submit-button') ||
                      document.querySelector('button#submit-button-end');
    
    if (postButton) {
      console.log('Found post button:', postButton);
      console.log('Post button tag, id, class, aria-label:', postButton.tagName, postButton.id, postButton.className, postButton.getAttribute('aria-label'));
      return postButton;
    }
    
    // Log all buttons for debugging
    const allButtons = document.querySelectorAll('button');
    console.log('All buttons found:', allButtons.length);
    
    // Try to find any button with "回复", "Comment", or "Post" in aria-label or text
    const buttonsWithText = Array.from(allButtons).filter(button => {
      const ariaLabel = button.getAttribute('aria-label') || '';
      const text = button.textContent || '';
      return ariaLabel.includes('回复') || ariaLabel.includes('Comment') || ariaLabel.includes('Post') ||
             text.includes('回复') || text.includes('Comment') || text.includes('Post');
    });
    
    if (buttonsWithText.length > 0) {
      console.log('Found buttons with relevant text:', buttonsWithText);
      // Return the last one (usually the post button appears last)
      return buttonsWithText[buttonsWithText.length - 1];
    }
    
    // Log all buttons for debugging
    allButtons.forEach((button, index) => {
      const ariaLabel = button.getAttribute('aria-label') || '';
      const text = button.textContent || '';
      if (ariaLabel || text) {
        console.log(`Button ${index}: aria-label="${ariaLabel}", text="${text}"`);
      }
    });
    
    console.log('Post button not found');
    return null;
  }

  async typeText(element, text) {
    console.log('Typing text into element:', element.tagName, element.type);
    
    // Wait a bit for the element to be fully ready
    await this.sleep(500);
    
    // Handle different element types
    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
      // For YouTube Studio's tp-yt-iron-autogrow-textarea, we need to be more careful
      const ironTextarea = element.closest('tp-yt-iron-autogrow-textarea');
      if (ironTextarea) {
        // Use the iron component's API if available
        try {
          // Try to set the value using the property if it exists
          if (typeof ironTextarea.setValue === 'function') {
            ironTextarea.setValue(text);
          } else if (ironTextarea.bindValue !== undefined) {
            ironTextarea.bindValue = text;
          } else if (ironTextarea.value !== undefined) {
            ironTextarea.value = text;
          }
          
          // Update the native textarea element
          element.value = text;
          
          // Update the mirror div that shows the text
          const mirror = ironTextarea.querySelector('#mirror');
          if (mirror) {
            mirror.textContent = text;
          }
          
          // Trigger input event on the textarea element
          element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          
          // Trigger polymer events with proper composition
          setTimeout(() => {
            ironTextarea.dispatchEvent(new CustomEvent('value-changed', { 
              bubbles: true, 
              composed: true, 
              detail: { value: text } 
            }));
            ironTextarea.dispatchEvent(new CustomEvent('iron-input', { 
              bubbles: true, 
              composed: true 
            }));
          }, 50);
        } catch (error) {
          console.log('Error with iron textarea API, falling back to direct input:', error);
          // Fallback: try direct input
          element.focus();
          element.value = text;
          element.dispatchEvent(new Event('input', { bubbles: true }));
        }
      } else {
        // For regular input/textarea elements
        element.focus();
        element.value = text;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      }
    } else {
      // For contenteditable divs
      element.focus();
      element.textContent = text;
      
      // Trigger input events
      const inputEvent = new Event('input', { bubbles: true });
      const changeEvent = new Event('change', { bubbles: true });
      
      element.dispatchEvent(inputEvent);
      element.dispatchEvent(changeEvent);
    }
  }

  async closeReplyDialog() {
    try {
      console.log('Attempting to close reply dialog...');
      
      // First, check if there's an active reply dialog and close it properly
      const activeDialog = document.querySelector('ytcp-commentbox[is-reply][keyboard-focus]');
      if (activeDialog) {
        console.log('Found active reply dialog with keyboard focus');
        
        // Try to find the cancel button within this specific dialog
        const cancelButton = activeDialog.querySelector('#cancel-button button') ||
                             activeDialog.querySelector('button[aria-label*="取消"]') ||
                             activeDialog.querySelector('ytcp-comment-button#cancel-button button');
        
        if (cancelButton) {
          console.log('Found cancel button in active dialog, clicking...');
          cancelButton.click();
          await this.sleep(1000);
          return;
        }
        
        // If no cancel button, try to find the reply button that opened this dialog
        const commentContainer = activeDialog.closest('ytcp-comment');
        if (commentContainer) {
          const replyButton = commentContainer.querySelector('button[aria-label*="回复"]');
          if (replyButton) {
            console.log('Found reply button for this comment, clicking to toggle...');
            replyButton.click();
            await this.sleep(1000);
            return;
          }
        }
      }
      
      // Fallback: try to find any cancel button
      const cancelButton = document.querySelector('ytcp-comment-button#cancel-button button') ||
                           document.querySelector('#cancel-button button') ||
                           document.querySelector('button[aria-label*="取消"]');
      
      if (cancelButton) {
        console.log('Found cancel button, clicking...');
        cancelButton.click();
        await this.sleep(1000);
        return;
      }
      
      // Try pressing Escape key
      console.log('Trying Escape key to close dialog...');
      const escEvent = new KeyboardEvent('keydown', {
        key: 'Escape',
        keyCode: 27,
        bubbles: true,
        cancelable: true
      });
      document.dispatchEvent(escEvent);
      await this.sleep(500);
      
      // Check if dialog is still open
      const remainingDialog = document.querySelector('ytcp-commentbox[is-reply]');
      if (!remainingDialog) {
        console.log('Dialog successfully closed with Escape key');
        return;
      }
      
      // Last resort - but be more careful about which reply button we click
      console.log('Dialog still open, looking for correct reply button to toggle...');
      const replyButtons = Array.from(document.querySelectorAll('button[aria-label*="回复"]'));
      
      // Find a reply button that has an open dialog
      for (const button of replyButtons) {
        const commentContainer = button.closest('ytcp-comment');
        if (commentContainer && commentContainer.querySelector('ytcp-commentbox[is-reply]')) {
          console.log('Found reply button with open dialog, clicking to toggle...');
          button.click();
          await this.sleep(1000);
          break;
        }
      }
      
      console.log('Dialog close attempt completed');
    } catch (error) {
      console.error('Error closing reply dialog:', error);
    }
  }

  checkIfReplyWasPosted(replyText) {
    try {
      // Look for the reply text in the document
      const textElements = document.querySelectorAll('#content-text, .yt-core-attributed-string');
      
      for (const element of textElements) {
        const text = element.textContent || '';
        // Check if this element contains our reply text
        if (text.includes(replyText.substring(0, 20)) && text.length >= replyText.length * 0.8) {
          // Check if this is a reply (not the original comment)
          const commentContainer = element.closest('ytcp-comment');
          if (commentContainer) {
            // Check if it has the 'is-reply' attribute or is inside a reply thread
            const isReply = commentContainer.hasAttribute('is-reply') || 
                           commentContainer.closest('.comment-thread-replies') !== null;
            if (isReply || element.closest('ytcp-comment[is-reply]')) {
              console.log('Found posted reply:', text.substring(0, 50) + '...');
              return true;
            }
          }
        }
      }
      
      return false;
    } catch (error) {
      console.error('Error checking if reply was posted:', error);
      return false;
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Add more debugging information
console.log('YouTube AI Reply content script loading...');

// Initialize the comment monitor
const commentMonitor = new YouTubeCommentMonitor();

// Export for debugging
window.youtubeAIReply = commentMonitor;

// Add helper function to reset reply count
window.resetReplyCount = function() {
  chrome.storage.local.remove(['replyCount'], () => {
    console.log('Reply count has been reset');
  });
};

console.log('YouTube AI Reply content script initialized');
console.log('Use resetReplyCount() in console to reset daily reply limit');