import React from 'react';
import { extractDocumentTitle } from '../utils/markdownDocUtils.js';
import { DocumentFileCard } from './DocumentFileCard.js';

interface MarkdownDocCardProps {
  content: string;
  onOpenRightPanel: (title: string, content: string) => void;
}

export const MarkdownDocCard: React.FC<MarkdownDocCardProps> = ({ content, onOpenRightPanel }) => {
  const title = extractDocumentTitle(content);
  return <DocumentFileCard name={title} content={content} extension=".md" onOpen={() => onOpenRightPanel(title, content)} />;
};
