class ChatBot {
    constructor() {
        this.API_KEY = '';
        this.API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent';
        this.FILE_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';
        this.isSpeaking = false;
        this.isListening = false; // Start with STT disabled
        this.ttsEnabled = false; // Start with TTS disabled
        this.voices = [];
        this.preferredVoice = null;
        this.chatHistory = [];
        this.fileData = null;
        this.uploadedFiles = [];
        this.contextMemory = [];
        this.userInfo = {
            name: null,
            preferences: {}
        };
        this.pendingFile = null;
        this.isProcessing = false;
        this.ttsSupported = 'speechSynthesis' in window;
        this.preloadImages();
        
        // Add exit handler
        window.addEventListener('beforeunload', (e) => {
            if (this.chatHistory.length > 0) {
                e.preventDefault();
                e.returnValue = 'Are you sure you want to leave? All chat history will be lost.';
            }
        });

        this.imageGenerationMode = false;
        this.defaultImageSettings = {
            width: 768,
            height: 768,
            seed: 43
        };

        this.translations = {
            en: 'en',
            hi: 'hi',
            mr: 'mr',
            ta: 'ta',
            te: 'te',
            bn: 'bn'
        };

        this.initVideoBackground();

        // Add user info check
        this.userDetails = JSON.parse(localStorage.getItem('userDetails')) || null;
        this.horoscopeData = JSON.parse(localStorage.getItem('horoscopeData')) || null;
    }

    async init() {
        try {
            await this.initElements();
            this.initSpeechRecognition();
            this.initEventListeners();
            this.initVoices();
            this.initIframeMode();
            this.initLanguageSelector();

            // Check for stored language preference
            const storedLang = localStorage.getItem('selectedLanguage');
            if (storedLang) {
                this.translatePage(storedLang);
                document.querySelector('.lang-btn span').textContent = storedLang.toUpperCase();
            }

            // Add initial greeting based on user data
            if (this.userDetails) {
                this.addMessage(
                    `Welcome back, ${this.userDetails.name}! I'm AstroBuddy, your personal astrology guide. ` +
                    `How can I assist you today?`, 
                    'bot'
                );
            } else {
                this.addMessage(
                    'Welcome! Please fill out your details first to get personalized astrological insights.', 
                    'bot'
                );
            }
        } catch (error) {
            console.error('Initialization error:', error);
        }
    }

    async initElements() {
        // Wait for DOM to be ready
        if (!document.getElementById('chatMessages')) {
            throw new Error('Required DOM elements not found');
        }

        this.avatar = document.getElementById('avatar');
        this.chatMessages = document.getElementById('chatMessages');
        this.userInput = document.getElementById('userInput');
        this.sendBtn = document.getElementById('sendBtn');
        this.ttsToggle = document.getElementById('ttsToggle');
        this.sttToggle = document.getElementById('sttToggle');
        this.fileInput = document.getElementById('fileInput');
        this.filePreview = document.getElementById('filePreview');
        this.clearHistoryBtn = document.getElementById('clearHistoryBtn');
    }

    initSpeechRecognition() {
        if ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window) {
            this.recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
            this.recognition.continuous = false;
            this.recognition.interimResults = true; // Enable interim results

            this.recognition.onstart = () => {
                this.userInput.classList.add('listening');
                this.userInput.placeholder = 'Listening...';
            };

            this.recognition.onend = () => {
                this.userInput.classList.remove('listening');
                this.userInput.placeholder = 'Type your message...';
                this.isListening = false;
                this.sttToggle.classList.remove('active');
            };

            this.recognition.onresult = (event) => {
                const transcript = Array.from(event.results)
                    .map(result => result[0].transcript)
                    .join('');
                
                this.userInput.value = transcript;
                
                // Only send message if this is the final result
                if (event.results[0].isFinal) {
                    setTimeout(() => this.sendMessage(), 500); // Small delay before sending
                }
            };

            this.recognition.onerror = (event) => {
                console.error('Speech recognition error:', event.error);
                this.userInput.placeholder = 'Type your message...';
                this.isListening = false;
                this.sttToggle.classList.remove('active');
            };
        }
    }

    initEventListeners() {
        // Button click handlers
        this.sendBtn.addEventListener('click', () => this.sendMessage());
        this.userInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });

        // TTS and STT handlers
        this.ttsToggle.addEventListener('click', () => this.toggleTTS());
        this.sttToggle.addEventListener('click', () => this.toggleSTT());
        
        // File and clear history handlers
        this.fileInput.addEventListener('change', (e) => this.handleFileUpload(e));
        this.clearHistoryBtn.addEventListener('click', () => this.clearHistory());

        // Make chatbot accessible globally for file preview remove button
        window.chatbot = this;

        // Add command hint click handler
        document.querySelector('.command-tag').addEventListener('click', () => {
            // Directly trigger image generation mode
            this.imageGenerationMode = true;
            this.addMessage('/generate', 'user');
            this.addMessage('Please enter your image prompt:', 'bot');
        });
    }

    async sendMessage() {
        const message = this.userInput.value.trim();
        if (!message || this.isProcessing) return;

        // Check if user data exists
        if (!this.checkUserData()) {
            this.userInput.value = '';
            return;
        }

        this.userInput.value = '';
        this.isProcessing = true;

        try {
            const now = new Date();
            const dateTimeStr = now.toLocaleString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
            });
            // Add user message
            this.addMessage(message, 'user');

            // Build context with user data and horoscope
            const contextPrompt = `
    You are AstroBuddy, an expert Vedic astrology chatbot.
    Current Date and Time: ${dateTimeStr}
    
    Name: ${this.userDetails.name}
    Birth Date: ${this.userDetails.dob}
    Birth Time: ${this.userDetails.birthTime}
    Birth Place: ${this.userDetails.birthCity}, ${this.userDetails.birthState}


    Important:
    1. rashiChart must be an array of exactly 12 strings
    2. Each planetary position must include all 4 fields
    3. Keep responses concise and specific
    4. Base all calculations on provided birth details
    5. Include astrological reasoning
    
    For daily advice or questions:
    1. Reference current planetary transits
    2. Consider dasha periods
    3. Include timing recommendations
    4. Explain astrological logic
    5. Keep responses practical and clear

    Current user message: ${message}`;

            const aiResponse = await this.getGeminiResponse(contextPrompt);
            
            if (aiResponse) {
                this.addMessage(aiResponse, 'bot');
                if (this.ttsEnabled) {
                    await this.speak(aiResponse);
                }
            }

        } catch (error) {
            console.error('Error:', error);
            this.addMessage('Sorry, I encountered an error processing your request.', 'bot');
        } finally {
            this.isProcessing = false;
        }
    }

    buildContextPrompt(message) {
        let prompt = '';
        
        // Add user info
        if (this.userInfo.name) {
            prompt += `User's name is ${this.userInfo.name}. `;
        }

        // Add last 3 context items
        const recentContext = this.contextMemory.slice(-3);
        if (recentContext.length > 0) {
            prompt += 'Recent conversation: ';
            recentContext.forEach(ctx => {
                prompt += `User: ${ctx.text}. Assistant: ${ctx.response}. `;
            });
        }

        prompt += `Current message: ${message}`;
        return prompt;
    }

    updateContext(message) {
        this.contextMemory.push({
            type: 'text',
            text: message,
            timestamp: Date.now()
        });
    }

    async getGeminiResponse(message) {
        const response = await fetch(`${this.API_URL}?key=${this.API_KEY}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{
                        text: `You are an AI assistant. Respond naturally without prefixes like "Improved message:". Current message: ${message}`
                    }]
                }]
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        return data.candidates[0].content.parts[0].text;
    }

    async handleFileUpload(event) {
        const file = event.target.files[0];
        if (!file || !this.validateFile(file)) return;

        const fileType = file.type.split('/')[0];
        const apiEndpoint = this.getApiEndpoint(fileType);

        try {
            const base64Data = await this.fileToBase64(file);
            this.pendingFile = {
                name: file.name,
                type: file.type,
                data: base64Data,
                fullSize: true // Flag to use full image
            };
            
            this.updateFilePreview(file, base64Data);
        } catch (error) {
            console.error('File upload error:', error);
            this.addMessage('Error processing file.', 'bot');
        }
    }

    validateFile(file) {
        const maxSize = 100 * 1024 * 1024; // 100MB
        const allowedTypes = [
            'image/jpeg', 'image/png', 'image/gif',
            'audio/mpeg', 'audio/wav', 'audio/mp3',
            'video/mp4', 'video/webm',
            'application/pdf',
            'text/plain'
        ];
        
        if (file.size > maxSize) {
            this.addMessage('File too large. Maximum size is 100MB.', 'bot');
            return false;
        }
        
        if (!allowedTypes.includes(file.type)) {
            this.addMessage('Unsupported file type. Please upload an allowed file type.', 'bot');
            return false;
        }
        
        return true;
    }

    fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => {
                const base64Data = reader.result.split(',')[1];
                resolve(base64Data);
            };
            reader.onerror = error => reject(error);
        });
    }

    async getGeminiResponseWithFile(prompt, base64Data, mimeType) {
        const response = await fetch(`${this.FILE_API_URL}?key=${this.API_KEY}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        {
                            inline_data: {
                                mime_type: mimeType,
                                data: base64Data
                            }
                        },
                        {
                            text: prompt
                        }
                    ]
                }]
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
            throw new Error('Invalid response format');
        }

        return data.candidates[0].content.parts[0].text;
    }

    addMessageWithImage(text, sender, imageData) {
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('message', `${sender}-message`);
        
        const { ttsText, htmlText } = this.formatMarkdown(text);
        
        messageDiv.innerHTML = `
            ${htmlText}
            <img src="data:image/jpeg;base64,${imageData}" 
                 class="message-image" 
                 alt="Uploaded image">
        `;
        
        this.chatMessages.appendChild(messageDiv);
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
        
        if (sender === 'user') {
            this.chatHistory.push({ 
                text, 
                sender, 
                imageData,
                timestamp: Date.now()
            });
        }
    }

    addMessageWithFile(text, sender, file, base64Data) {
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('message', `${sender}-message`);
        
        const { ttsText, htmlText } = this.formatMarkdown(text);
        
        let filePreview = '';
        if (file.type.startsWith('image/')) {
            filePreview = `
                <div class="message-file-preview">
                    <img src="data:${file.type};base64,${base64Data}" 
                         alt="File preview"
                         class="message-preview-image">
                    <div class="file-info">
                        <i class="fas fa-file-image"></i>
                        ${file.name}
                    </div>
                </div>
            `;
        } else {
            filePreview = `
                <div class="message-file-preview">
                    <div class="file-info">
                        <i class="fas fa-file-alt"></i>
                        ${file.name}
                    </div>
                </div>
            `;
        }
        
        messageDiv.innerHTML = `
            ${htmlText}
            ${filePreview}
        `;
        
        this.chatMessages.appendChild(messageDiv);
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
        
        if (sender === 'user') {
            this.chatHistory.push({ 
                text, 
                sender, 
                file: {
                    name: file.name,
                    type: file.type,
                    data: base64Data
                },
                timestamp: Date.now()
            });
        }
    }

    compressImageData(base64Data) {
        return base64Data;
    }

    updateFilePreview(file, base64Data) {
        let icon, className;
        
        switch(file.type.split('/')[0]) {
            case 'image':
                icon = 'fa-image';
                className = 'image-preview';
                break;
            case 'audio':
                icon = 'fa-music';
                className = 'audio-preview';
                break;
            case 'video':
                icon = 'fa-video';
                className = 'video-preview';
                break;
            case 'application':
                icon = 'fa-file-pdf';
                className = 'pdf-preview';
                break;
            default:
                icon = 'fa-file-alt';
                className = 'text-preview';
        }

        const previewHTML = file.type.startsWith('image/') ? `
            <img src="data:${file.type};base64,${base64Data}" alt="Preview">
        ` : `
            <i class="fas ${icon} fa-2x"></i>
            <audio controls src="data:${file.type};base64,${base64Data}"></audio>
        `;

        this.filePreview.innerHTML = `
            <div class="preview-container ${className}">
                ${previewHTML}
                <div class="file-info">
                    <i class="fas ${icon}"></i>
                    ${file.name}
                </div>
                <button class="remove-file" onclick="window.chatbot.clearPendingFile()">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;
    }

    clearPendingFile() {
        this.pendingFile = null;
        this.filePreview.innerHTML = '';
        this.fileInput.value = '';
    }

    formatMarkdown(text) {
        // Remove markdown from TTS text
        const ttsText = text
            .replace(/#{1,6}\s+/g, '') // Remove headings
            .replace(/(\*\*\*|\*\*|\*)/g, '') // Remove bold/italic
            .replace(/```[\s\S]*?```/g, 'code block') // Replace code blocks
            .replace(/`([^`]+)`/g, '$1') // Remove inline code
            .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1'); // Handle links

        // Format HTML display
        const htmlText = text
            .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>') // Code blocks
            .replace(/#{6}\s+(.*?)\n/g, '<h6>$1</h6>')
            .replace(/#{5}\s+(.*?)\n/g, '<h5>$1</h5>')
            .replace(/#{4}\s+(.*?)\n/g, '<h4>$1</h4>')
            .replace(/#{3}\s+(.*?)\n/g, '<h3>$1</h3>')
            .replace(/#{2}\s+(.*?)\n/g, '<h2>$1</h2>')
            .replace(/#{1}\s+(.*?)\n/g, '<h1>$1</h1>')
            .replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\n/g, '<br>');

        return { ttsText, htmlText };
    }

    addMessage(text, sender) {
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('message', `${sender}-message`);
        
        const { ttsText, htmlText } = this.formatMarkdown(text);
        messageDiv.innerHTML = htmlText;
        
        this.chatMessages.appendChild(messageDiv);
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;

        // Store TTS text for speaking
        messageDiv.dataset.ttsText = ttsText;
        
        this.chatHistory.push({ 
            text, 
            sender,
            timestamp: Date.now() 
        });
        
        return ttsText;
    }

    preloadImages() {
        // Preload avatar images
        const staticImg = new Image();
        staticImg.src = 'staticbaba.jpg';
        
        const speakingImg = new Image();
        speakingImg.src = 'speakingbaba.gif';
        
        this.preloadedImages = {
            static: staticImg,
            speaking: speakingImg
        };
    }

    clearHistory() {
        this.chatHistory = [];
        this.chatMessages.innerHTML = '';
        this.uploadedFiles = [];
        this.clearPendingFile();
    }

    initVoices() {
        if (!this.ttsSupported) return;

        // Load available voices
        const loadVoices = () => {
            this.voices = speechSynthesis.getVoices();
            if (this.voices.length) {
                this.setPreferredVoice();
            }
        };

        loadVoices();
        speechSynthesis.onvoiceschanged = loadVoices;
    }

    setPreferredVoice() {
        // Try to find a male voice for baba/pandit effect
        this.preferredVoice = this.voices.find(voice => 
            voice.lang.includes('en') && 
            (voice.name.toLowerCase().includes('male') || 
             voice.name.toLowerCase().includes('daniel'))
        ) || this.voices[0];
    }

    speak(text) {
        if (!this.ttsEnabled || !this.ttsSupported) return;

        speechSynthesis.cancel();
        this.avatar.src = this.preloadedImages.speaking.src;

        const { ttsText } = this.formatMarkdown(text);
        const sentences = ttsText
            .split(/([.!?]\s+|\n)/)
            .filter(sentence => sentence.trim().length > 0);

        this.isSpeaking = true;

        let index = 0;
        const speakNextSentence = () => {
            if (index >= sentences.length) {
                this.avatar.src = this.preloadedImages.static.src;
                this.isSpeaking = false;
                return;
            }

            const utterance = new SpeechSynthesisUtterance(sentences[index]);
            if (this.preferredVoice) {
                utterance.voice = this.preferredVoice;
            }
            
            // Updated voice parameters for faster baba voice
            utterance.pitch = 0.8;     // Keep lower pitch for elderly voice
            utterance.rate = 1.2;      // Increased speed
            utterance.volume = 1.0;
            utterance.lang = 'en-US';

            utterance.onend = () => {
                setTimeout(() => {
                    index++;
                    speakNextSentence();
                }, 150);               // Reduced pause between sentences
            };

            utterance.onerror = (event) => {
                console.error('TTS Error:', event);
                this.avatar.src = this.preloadedImages.static.src;
                this.isSpeaking = false;
                this.ttsEnabled = false;
                this.ttsToggle.classList.remove('active');
            };

            speechSynthesis.speak(utterance);
        };

        speakNextSentence();
    }

    toggleTTS() {
        if (!this.ttsSupported) {
            alert('Text-to-speech is not supported in your browser');
            return;
        }

        this.ttsEnabled = !this.ttsEnabled;
        
        if (this.ttsEnabled) {
            this.ttsToggle.classList.add('active');
            const testUtterance = new SpeechSynthesisUtterance('TTS enabled');
            testUtterance.onend = () => {
                console.log('TTS test complete');
            };
            testUtterance.onerror = (err) => {
                console.error('TTS test failed:', err);
                this.ttsEnabled = false;
                this.ttsToggle.classList.remove('active');
            };
            speechSynthesis.speak(testUtterance);
        } else {
            this.ttsToggle.classList.remove('active');
            speechSynthesis.cancel();
            if (this.isSpeaking) {
                this.avatar.src = this.preloadedImages.static.src;
                this.isSpeaking = false;
            }
        }
    }

    toggleSTT() {
        if (!this.isListening) {
            this.recognition.start();
            this.sttToggle.classList.add('active');
            this.isListening = true;
        } else {
            this.recognition.stop();
            this.sttToggle.classList.remove('active');
            this.isListening = false;
        }
    }

    initIframeMode() {
        const chatBall = document.getElementById('chatBall');
        const chatContainer = document.getElementById('chatContainer');
        const closeBtn = document.getElementById('closeChat');
        const minimizeBtn = document.getElementById('minimizeChat');

        const showChat = () => {
            chatBall.style.display = 'none';
            chatContainer.style.display = 'flex';
            requestAnimationFrame(() => {
                chatContainer.classList.add('show');
                chatContainer.classList.remove('hide');
            });
        };

        const hideChat = () => {
            chatContainer.classList.remove('show');
            chatContainer.classList.add('hide');
            setTimeout(() => {
                chatContainer.style.display = 'none';
                chatBall.style.display = 'flex';
                chatContainer.classList.remove('hide');
            }, 300);
        };

        chatBall.addEventListener('click', showChat);
        minimizeBtn.addEventListener('click', hideChat);
        closeBtn.addEventListener('click', () => {
            hideChat();
            this.clearHistory();
        });
    }

    getApiEndpoint(fileType) {
        return 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';
    }

    generateImage(prompt) {
        const { width, height, seed } = this.defaultImageSettings;
        const imageUrl = ``;
        
        // Add user prompt message
        this.addMessage(`Generate image: ${prompt}`, 'user');
        
        // Add bot response with image
        const botMessageDiv = document.createElement('div');
        botMessageDiv.classList.add('message', 'bot-message');
        botMessageDiv.innerHTML = `
            <div>Here's your generated image:</div>
            <div class="image-container">
                <div class="image-loading">
                    <i class="fas fa-spinner fa-spin"></i>
                    Generating image...
                </div>
                <img src="${imageUrl}" 
                     class="generated-image" 
                     alt="Generated image"
                     style="display: none"
                     onclick="window.chatbot.zoomImage(this.src)">
                <div class="image-actions" style="display: none">
                    <a href="${imageUrl}" 
                       download="generated-image.png" 
                       class="download-btn">
                        <i class="fas fa-download"></i> Download
                    </a>
                    <button onclick="window.chatbot.zoomImage('${imageUrl}')">
                        <i class="fas fa-search-plus"></i> Zoom
                    </button>
                </div>
            </div>
        `;

        this.chatMessages.appendChild(botMessageDiv);
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;

        const img = botMessageDiv.querySelector('.generated-image');
        const loading = botMessageDiv.querySelector('.image-loading');
        const actions = botMessageDiv.querySelector('.image-actions');

        img.onload = () => {
            loading.style.display = 'none';
            img.style.display = 'block';
            actions.style.display = 'flex';
        };

        // Add to chat history
        this.chatHistory.push({
            text: prompt,
            sender: 'user',
            timestamp: Date.now()
        });
        this.chatHistory.push({
            text: 'Here\'s your generated image:',
            sender: 'bot',
            imageUrl: imageUrl,
            timestamp: Date.now()
        });
    }

    downloadImage(url, filename) {
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    zoomImage(url) {
        const modal = document.createElement('div');
        modal.className = 'image-modal';
        modal.innerHTML = `
            <div class="modal-content">
                <img src="${url}" alt="Zoomed image">
                <button class="modal-close" onclick="this.parentElement.parentElement.remove()">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;
        document.body.appendChild(modal);
    }

    initVideoBackground() {
        const video = document.getElementById('backgroundVideo');
        
        if (video) {
            let isReversed = false;
            
            // Play video initially
            video.play().catch(function(error) {
                console.log("Video autoplay failed:", error);
            });

            // Handle video end
            video.addEventListener('ended', function() {
                // Prevent the default loop behavior
                event.preventDefault();
                
                if (!isReversed) {
                    // Play in reverse
                    video.currentTime = video.duration;
                    video.playbackRate = -1;
                    isReversed = true;
                } else {
                    // Play forward
                    video.currentTime = 0;
                    video.playbackRate = 1;
                    isReversed = false;
                }
                
                // Start playing in new direction
                video.play();
            });
        }
    }

    initLanguageSelector() {
        const langBtn = document.querySelector('.lang-btn');
        const dropdown = document.querySelector('.language-dropdown');
        const langOptions = document.querySelectorAll('.language-dropdown a');

        // Toggle dropdown on button click
        langBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', () => {
            dropdown.style.display = 'none';
        });

        // Prevent dropdown from closing when clicking inside
        dropdown.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        // Handle language selection
        langOptions.forEach(option => {
            option.addEventListener('click', (e) => {
                e.preventDefault();
                const lang = e.target.dataset.lang;
                const text = e.target.textContent;
                
                langBtn.querySelector('span').textContent = text;
                dropdown.style.display = 'none';
                
                // Trigger Google Translate
                const select = document.querySelector('.goog-te-combo');
                if (select) {
                    select.value = lang;
                    select.dispatchEvent(new Event('change'));
                }
            });
        });
    }

    async changeLanguage(lang) {
        try {
            // Use Google Translate API (requires API key and setup)
            const elements = document.querySelectorAll('[data-translate]');
            elements.forEach(async (element) => {
                const key = element.dataset.translate;
                // Implement translation logic here
            });
        } catch (error) {
            console.error('Translation error:', error);
        }
    }

    translatePage(lang) {
        // Initialize Google Translate
        if (!window.googleTranslateElementInit) {
            window.googleTranslateElementInit = () => {
                new google.translate.TranslateElement({
                    pageLanguage: 'en',
                    includedLanguages: Object.values(this.translations).join(','),
                    layout: google.translate.TranslateElement.InlineLayout.SIMPLE,
                    autoDisplay: false
                }, 'google_translate_element');
            };
        }

        // Get Google Translate object
        const googleTranslate = document.querySelector('.goog-te-combo');
        if (googleTranslate) {
            // Set language
            googleTranslate.value = this.translations[lang];
            googleTranslate.dispatchEvent(new Event('change'));
        }

        // Store selected language
        localStorage.setItem('selectedLanguage', lang);
    }

    // Add method to check user data
    checkUserData() {
        if (!this.userDetails || !this.horoscopeData) {
            this.addMessage(
                "Please complete your horoscope details first to chat with AstroBuddy. " +
                "Click here to fill your details. <a href='form.html'>Fill Details</a>", 
                'bot'
            );
            
            // Add clickable link
            const lastMessage = this.chatMessages.lastElementChild;
            lastMessage.style.cursor = 'pointer';
            lastMessage.addEventListener('click', () => {
                window.location.href = 'form.html';
            });
            return false;
        }
        return true;
    }

    // Add this helper function
    cleanAndParseJSON(response) {
        try {
            // Remove markdown code blocks if present
            let cleanResponse = response.replace(/```json\s*|\s*```/g, '');
            
            // Try parsing the cleaned response
            return JSON.parse(cleanResponse);
        } catch (error) {
            console.error('JSON parsing error:', error);
            
            // Fallback data structure
            return {
                panchang: {
                    tithi: "Not available",
                    nakshatra: "Not available",
                    yoga: "Not available",
                    karana: "Not available",
                    day: "Not available"
                },
                rashiChart: Array(12).fill("Not available"),
                planetaryPositions: [
                    {
                        name: "Sun",
                        sign: "Not available",
                        degree: "0",
                        house: "1"
                    }
                ],
                dashas: {
                    maha: "Not available",
                    antar: "Not available",
                    pratyantar: "Not available"
                },
                remedies: ["Unable to calculate remedies at this time"]
            };
        }
    }

    async processHoroscopeData(response) {
        try {
            const data = await response.json();
            let horoscopeData;
            
            if (data.candidates && data.candidates[0].content.parts[0].text) {
                const aiResponse = data.candidates[0].content.parts[0].text;
                horoscopeData = this.cleanAndParseJSON(aiResponse);
            } else {
                throw new Error('Invalid API response format');
            }
            
            // Store horoscope data
            localStorage.setItem('horoscopeData', JSON.stringify(horoscopeData));
            
        } catch (error) {
            console.error('Error processing horoscope data:', error);
            // Use fallback data
            const fallbackData = this.cleanAndParseJSON("{}");
            localStorage.setItem('horoscopeData', JSON.stringify(fallbackData));
        }
    }
}

// Initialize chatbot
document.addEventListener('DOMContentLoaded', async () => {
    window.chatbot = new ChatBot();
    await window.chatbot.init();
    document.body.insertAdjacentHTML('beforeend', '<div id="google_translate_element" style="display:none"></div>');
});