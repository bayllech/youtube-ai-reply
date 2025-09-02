// Content script for YouTube comment detection and reply
class YouTubeCommentMonitor {
  constructor() {
    this.observer = null;
    this.processedComments = new Set();
    this.replyQueue = [];
    this.isProcessing = false;
    this.settings = null;
    
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
          if (this.isCommentElement(node)) {
            this.processNewComment(node);
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            // Check if the added node contains comments
            const comments = node.querySelectorAll('#comment #content, ytcp-comment #content-text');
            comments.forEach(comment => this.processNewComment(comment));
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
    
    // Log for debugging
    console.log('Checking if element is comment:', element.tagName, element.id, element.className);
    
    // Check various YouTube comment element selectors
    return element.id === 'comment' || 
           element.closest('#comment') ||
           element.tagName === 'YTD-COMMENT-THREAD-RENDERER' ||
           element.querySelector('#comment') ||
           element.querySelector('#comment-text') ||
           element.querySelector('.ytd-comment-thread-renderer') ||
           element.tagName === 'YTCP-COMMENT' ||
           element.closest('ytcp-comment') ||
           element.querySelector('ytcp-comment') ||
           (element.getAttribute && element.getAttribute('id') === 'comment');
  }

  processExistingComments() {
    try {
      console.log('Processing existing comments...');
      const existingComments = document.querySelectorAll('#comment #content, ytd-comment-thread-renderer #content-text, .ytd-comment-thread-renderer #content-text, ytcp-comment #content-text, ytcp-comment yt-formatted-string#content-text');
      console.log('Found', existingComments.length, 'existing comments');
      existingComments.forEach(comment => this.processNewComment(comment));
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
      
      if (!this.settings?.autoReplyEnabled) {
        return;
      }

      // Get comment ID to avoid duplicates
      const commentId = this.getCommentId(commentElement);
      if (this.processedComments.has(commentId)) {
        return;
      }

      // Mark as processed
      this.processedComments.add(commentId);

      // Extract comment text
      const commentText = this.extractCommentText(commentElement);
      if (!commentText || commentText.trim().length < 10) {
        return;
      }

      console.log('New comment detected:', commentText.substring(0, 100) + '...');

      // Add to reply queue
      this.replyQueue.push({
        commentId,
        commentText,
        element: commentElement,
        timestamp: Date.now()
      });

      // Process reply queue
      this.processReplyQueue();
    } catch (error) {
      console.error('Error processing new comment:', error);
      console.error('Comment element:', commentElement);
    }
  }

  getCommentId(commentElement) {
    try {
      // Try to get a unique identifier for the comment
      const comment = commentElement.closest('#comment') || commentElement.closest('ytcp-comment');
      if (comment) {
        // Try to get a unique ID from the comment element
        const id = comment.id || 
                  comment.getAttribute('data-comment-id') || 
                  comment.getAttribute('comment-id') ||
                  // Try to get text content as fallback (first 50 characters)
                  (comment.textContent ? comment.textContent.trim().substring(0, 50) : null);
        
        if (id) {
          // Remove any whitespace and return
          return id.replace(/\s+/g, '');
        }
      }
      
      // Fallback to random ID
      return Math.random().toString(36).substr(2, 9);
    } catch (error) {
      console.error('Error getting comment ID:', error);
      return Math.random().toString(36).substr(2, 9);
    }
  }

  extractCommentText(commentElement) {
    try {
      console.log('Attempting to extract comment text from element:', commentElement);
      
      // Find the comment text element using multiple selectors
      const textElement = commentElement.querySelector('#content-text') ||
                         commentElement.querySelector('#content-text #content') ||
                         commentElement.querySelector('.yt-core-attributed-string') ||
                         commentElement.querySelector('[id*="content-text"]') ||
                         commentElement.querySelector('.ytd-comment-renderer #content-text') ||
                         commentElement.querySelector('ytd-comment-renderer #content-text') ||
                         commentElement.querySelector('ytcp-comment yt-formatted-string#content-text') ||
                         commentElement.querySelector('yt-formatted-string#content-text');
      
      if (textElement) {
        const text = textElement.textContent.trim();
        console.log('Extracted comment text:', text.substring(0, 100) + '...');
        return text;
      }
      
      // Fallback: try to find text in the comment element
      const comment = commentElement.closest('#comment') || 
                     commentElement.closest('ytd-comment-thread-renderer') ||
                     commentElement.closest('ytd-comment-renderer') ||
                     commentElement.closest('ytcp-comment');
      
      if (comment) {
        const text = comment.textContent.trim();
        console.log('Extracted comment text from comment element:', text.substring(0, 100) + '...');
        // Remove common non-content text
        return text.replace(/Reply|Share|More|Like|Dislike|\d+ (seconds?|minutes?|hours?|days?|weeks?|months?|years? ago)/gi, '').trim();
      }
      
      // Additional fallback for YouTube Studio
      const contentTextElement = commentElement.querySelector('#content') || 
                                commentElement.querySelector('.content') ||
                                commentElement;
      if (contentTextElement) {
        const text = contentTextElement.textContent.trim();
        console.log('Extracted comment text from content element:', text.substring(0, 100) + '...');
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

    while (this.replyQueue.length > 0) {
      const comment = this.replyQueue.shift();
      
      // Check if we should reply to this comment
      if (await this.shouldReplyToComment(comment)) {
        await this.generateAndPostReply(comment);
      }

      // Add delay between replies
      await this.sleep(this.settings?.replyDelay || 3000);
    }

    this.isProcessing = false;
  }

  async shouldReplyToComment(comment) {
    // Check if auto-reply is enabled
    if (!this.settings?.autoReplyEnabled) {
      return false;
    }

    // Check reply limit
    if (this.settings?.maxRepliesPerSession) {
      const today = new Date().toDateString();
      const replyCount = await this.getTodayReplyCount();
      if (replyCount >= this.settings.maxRepliesPerSession) {
        console.log('Maximum replies reached for today');
        return false;
      }
    }

    // Avoid replying to very short comments
    if (comment.commentText.length < 10) {
      return false;
    }

    // Avoid replying to comments that might be spam
    const spamKeywords = ['subscribe', 'like', 'check out', 'visit my', 'my channel'];
    const lowerComment = comment.commentText.toLowerCase();
    if (spamKeywords.some(keyword => lowerComment.includes(keyword))) {
      return false;
    }

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
      await this.sleep(2000);

      console.log('Reply posted successfully');
      return true;

    } catch (error) {
      console.error('Error posting reply:', error);
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
    
    // Log all contenteditable elements for debugging
    const allEditable = document.querySelectorAll('div[contenteditable="true"]');
    console.log('All contenteditable elements found:', allEditable.length);
    allEditable.forEach((el, index) => {
      console.log(`Contenteditable element ${index}:`, el.tagName, el.id, el.className);
    });
    
    // Try multiple selectors for reply input, with more specific YouTube Studio selectors
    const input = document.querySelector('ytcp-comment div[contenteditable="true"]') ||
                  document.querySelector('ytcp-comment-thread div[contenteditable="true"]') ||
                  document.querySelector('ytcp-comment-renderer div[contenteditable="true"]') ||
                  document.querySelector('div[contenteditable="true"][id*="contenteditable"]') ||
                  document.querySelector('div[contenteditable="true"]#contenteditable-root') ||
                  document.querySelector('div[contenteditable="true"]') ||
                  document.querySelector('#contenteditable-root') ||
                  document.querySelector('.comment-simplebox-renderer div[contenteditable="true"]') ||
                  document.querySelector('ytd-comment-reply-dialog-renderer div[contenteditable="true"]');
    
    if (input) {
      console.log('Found reply input:', input);
      console.log('Reply input tag, id, class:', input.tagName, input.id, input.className);
      return input;
    } else {
      console.log('Reply input not found, checking document body for contenteditable elements');
      // Try to find any contenteditable element in the document
      const anyEditable = document.querySelector('div[contenteditable="true"]');
      if (anyEditable) {
        console.log('Found any contenteditable element:', anyEditable);
        return anyEditable;
      }
      
      // Log part of the document body for debugging
      console.log('Document body (first 1000 chars):', document.body.innerHTML.substring(0, 1000));
      return null;
    }
  }

  findPostButton() {
    console.log('Looking for post button...');
    
    // Log all buttons for debugging
    const allButtons = document.querySelectorAll('button');
    console.log('All buttons found:', allButtons.length);
    
    // Try multiple selectors for post button, with more specific YouTube Studio selectors
    const postButton = document.querySelector('ytcp-button[type="tonal"]') ||
                      document.querySelector('ytcp-button-shape button') ||
                      document.querySelector('button.ytcpButtonShapeImplHost') ||
                      document.querySelector('button[aria-label*="Comment"]') ||
                      document.querySelector('button[aria-label*="Post"]') ||
                      document.querySelector('button[aria-label*="comment"]') ||
                      document.querySelector('button[aria-label*="post"]') ||
                      document.querySelector('button[aria-label*="发布"]') ||
                      document.querySelector('button#submit-button') ||
                      document.querySelector('button#submit-button-end') ||
                      document.querySelector('.ytd-comment-reply-dialog-renderer button[type="submit"]');
    
    if (postButton) {
      console.log('Found post button:', postButton);
      console.log('Post button tag, id, class, aria-label:', postButton.tagName, postButton.id, postButton.className, postButton.getAttribute('aria-label'));
      return postButton;
    } else {
      console.log('Post button not found');
      // Try to find any button with "发布" or "Post" in aria-label
      const anyPostButton = document.querySelector('button[aria-label*="发布"], button[aria-label*="Post"], button[aria-label*="post"]');
      if (anyPostButton) {
        console.log('Found any post button:', anyPostButton);
        return anyPostButton;
      }
      
      // Log part of the document body for debugging
      console.log('Document body (first 1000 chars):', document.body.innerHTML.substring(0, 1000));
      return null;
    }
  }

  async typeText(element, text) {
    // Simulate typing text
    element.textContent = '';
    
    // Trigger input events
    const inputEvent = new Event('input', { bubbles: true });
    const changeEvent = new Event('change', { bubbles: true });
    
    // Type text character by character with small delays
    for (let i = 0; i < text.length; i++) {
      element.textContent += text[i];
      element.dispatchEvent(inputEvent);
      await this.sleep(Math.random() * 100 + 50); // Random delay between characters
    }
    
    element.dispatchEvent(changeEvent);
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

console.log('YouTube AI Reply content script initialized');