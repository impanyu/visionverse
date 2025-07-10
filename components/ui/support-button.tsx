import { useState } from 'react';
import { ThumbsUp } from 'lucide-react';
import { Button } from './button';

interface SupportButtonProps {
  visionId: string;
  initialSupportCount: number;
  initialIsSupported: boolean;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'default' | 'outline' | 'ghost';
  onSupportChange?: (newSupportCount: number, newIsSupported: boolean) => void;
}

export function SupportButton({ 
  visionId, 
  initialSupportCount, 
  initialIsSupported, 
  size = 'sm',
  variant = 'outline',
  onSupportChange
}: SupportButtonProps) {
  const [supportCount, setSupportCount] = useState(initialSupportCount);
  const [isSupported, setIsSupported] = useState(initialIsSupported);
  const [isLoading, setIsLoading] = useState(false);

  const handleSupportToggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (isLoading) return;
    
    setIsLoading(true);
    
    try {
      const response = await fetch('/api/support_vision', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ visionId }),
      });

      if (!response.ok) {
        throw new Error('Failed to toggle support');
      }

      const result = await response.json();
      
      if (result.success) {
        setSupportCount(result.supportCount);
        setIsSupported(result.isSupported);
        
        // Notify parent component of the change
        if (onSupportChange) {
          onSupportChange(result.supportCount, result.isSupported);
        }
      }
    } catch (error) {
      console.error('Error toggling support:', error);
      // Optionally show error message to user
    } finally {
      setIsLoading(false);
    }
  };

  const buttonSize = size === 'sm' ? 'h-7 px-2' : size === 'md' ? 'h-8 px-3' : 'h-9 px-4';
  const iconSize = size === 'sm' ? 'h-3 w-3' : size === 'md' ? 'h-4 w-4' : 'h-5 w-5';
  const textSize = size === 'sm' ? 'text-xs' : size === 'md' ? 'text-sm' : 'text-base';

  return (
    <Button
      variant={variant}
      size="sm"
      onClick={handleSupportToggle}
      disabled={isLoading}
      className={`${buttonSize} ${textSize} ${
        isSupported 
          ? 'bg-blue-100 text-blue-700 border-blue-300 hover:bg-blue-200' 
          : 'hover:bg-gray-100'
      } transition-colors flex items-center gap-1.5`}
    >
      <ThumbsUp 
        className={`${iconSize} ${
          isSupported ? 'fill-current' : ''
        } transition-all duration-200`}
      />
      <span className="font-medium">{supportCount} people require this</span>
    </Button>
  );
} 