#!/bin/bash

# Fix for PHP repository setup in Pelican Panel installation script
# Replace the STEP 3 section with this improved version

# ============================================================================
# STEP 3: Add PHP 8.4 Repository (FIXED VERSION)
# ============================================================================
echo -e "${YELLOW}[3/16] Adding PHP 8.4 repository...${NC}"

# Remove any existing PHP repositories
rm -f /etc/apt/sources.list.d/php*.list 2>/dev/null || true
rm -f /etc/apt/trusted.gpg.d/php*.gpg 2>/dev/null || true

# Detect OS
if [ -f /etc/debian_version ]; then
    DISTRO=$(lsb_release -sc)
    
    # Method 1: Try ondrej PPA (more reliable for Ubuntu)
    if command -v add-apt-repository &> /dev/null; then
        echo "Using ondrej PPA method..."
        add-apt-repository ppa:ondrej/php -y
        apt update
    else
        # Method 2: Manual setup for Debian/Ubuntu without add-apt-repository
        echo "Using manual repository setup..."
        
        # Download and install GPG key properly
        curl -fsSL https://packages.sury.org/php/apt.gpg | gpg --dearmor -o /usr/share/keyrings/php.gpg
        
        # Add repository with proper signing
        echo "deb [signed-by=/usr/share/keyrings/php.gpg] https://packages.sury.org/php/ $DISTRO main" | tee /etc/apt/sources.list.d/php.list
        
        apt update
    fi
else
    echo -e "${RED}Unsupported OS. Please install PHP 8.4 manually.${NC}"
    exit 1
fi

# Verify repository was added
if apt-cache policy php8.4-cli | grep -q "packages.sury.org\|ondrej"; then
    echo -e "${GREEN}✅ PHP 8.4 repository added successfully${NC}"
else
    echo -e "${YELLOW}⚠️  Repository added but verification failed. Continuing anyway...${NC}"
fi

