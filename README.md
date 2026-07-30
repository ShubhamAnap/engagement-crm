# EnerTech Engage AI

You are a world-class Senior Product Designer, UX Architect, Enterprise Software Designer, and Frontend Engineer.

Your task is to design a production-ready AI Customer Engagement Platform for EnerTech UPS Pvt. Ltd.

IMPORTANT:

This is NOT a startup landing page.

This is NOT a chatbot demo.

This is NOT an MVP.

This is a complete enterprise web application that customer support executives, sales teams, service engineers, managers, and administrators will use every day.

The application should feel comparable to products like:

• Intercom

• Zendesk

• HubSpot CRM

• Salesforce

• Front

• Linear

• Slack

• Notion

• ChatGPT Team

• FloGPT

• Microsoft Teams

• Freshworks

The goal is to create the most intuitive AI-powered customer engagement platform for a manufacturing company.

The application should support Website Chat, WhatsApp, Email, Instagram, Facebook Messenger, and future communication channels.

This platform will initially be built for one enterprise (EnerTech UPS Pvt. Ltd.) and later be converted into a SaaS platform.

Therefore, the architecture, UI, components, and navigation should already be scalable even though the initial deployment is for a single organization.

--------------------------------------------------

DESIGN PHILOSOPHY

--------------------------------------------------

The UI should feel:

Modern

Minimal

Premium

Professional

Enterprise

Fast

Highly organized

Easy to learn

Easy to scale

Data focused

Productivity focused

Avoid unnecessary animations.

Avoid fancy gradients.

Avoid excessive colors.

Use whitespace correctly.

Use reusable components everywhere.

The interface should look like software built by a billion-dollar software company.

--------------------------------------------------

TECH STACK

--------------------------------------------------

Next.js

React

Tailwind CSS

shadcn/ui

Lucide Icons

Framer Motion (minimal)

TypeScript

Responsive Design

Reusable Components

--------------------------------------------------

THEME SYSTEM

--------------------------------------------------

Support:

• Dark Theme

• Light Theme

• System Theme

Dark Mode should be default.

Theme preference should be remembered.

Every page should support both themes.

Never break layout when changing themes.

--------------------------------------------------

LAYOUT

--------------------------------------------------

Permanent Left Sidebar

Top Navigation

Large Workspace

Responsive

Sticky Header

Sticky Sidebar

Resizable panels where appropriate.

--------------------------------------------------

LEFT SIDEBAR

--------------------------------------------------

Dashboard

AI Command Center

Inbox

AI Chat Support

AI Agents

Knowledge Base

Products

Customers

Leads

Pipeline

Analytics

Automation

Channels

Human Support

Reports

Settings

Sidebar should support collapse.

--------------------------------------------------

TOP NAVIGATION

--------------------------------------------------

Global Search

Notifications

Theme Toggle

Current User

Company Logo

Quick Actions

Profile Menu

--------------------------------------------------

MODULE 1

DASHBOARD

--------------------------------------------------

Display:

Active Conversations

Today's Conversations

Open Tickets

Pending Human Escalations

AI Resolution Rate

Human Resolution Rate

Average Response Time

Customer Satisfaction

New Leads

Qualified Leads

Revenue Generated

Open Opportunities

Recent Activity

Recent Conversations

Recent Leads

Top Products

Charts

Conversation Trend

Lead Funnel

Sales Pipeline

Channel Distribution

--------------------------------------------------

MODULE 2

AI COMMAND CENTER

--------------------------------------------------

Live AI conversations.

Real-time monitoring.

Show:

Current AI Agent

Current Customer

Confidence Score

Knowledge Sources

Memory Status

Token Usage

Latency

Escalation Status

Take Over Button

Pause AI

Resume AI

Assign Human

Conversation Timeline

--------------------------------------------------

MODULE 3

OMNICHANNEL INBOX

--------------------------------------------------

Three-column layout.

Left:

Conversation list

Filters

Unread

Assigned

Website

WhatsApp

Instagram

Facebook

Email

Middle:

Conversation

Rich Messages

Images

Videos

PDF

Voice Notes

Typing Indicator

AI Suggestions

Right:

Customer Profile

Name

Company

Phone

Email

Lead Score

Interested Products

Conversation Summary

Internal Notes

Past Purchases

Assigned Executive

Timeline

--------------------------------------------------

MODULE 4

AI CHAT SUPPORT

--------------------------------------------------

Monitor AI responses.

Show:

Retrieved Documents

Memory

Reasoning

Confidence

Product Recommendation

Lead Qualification

Hallucination Warning

Sources

Suggested Next Action

--------------------------------------------------

MODULE 5

AI AGENTS

--------------------------------------------------

Cards

Sales Agent

Support Agent

Technical Agent

Warranty Agent

Battery Calculator Agent

Quotation Agent

Follow-up Agent

Email Agent

Each card shows

Status

Health

Requests Today

Average Latency

Memory Enabled

Model

Cost

--------------------------------------------------

MODULE 6

KNOWLEDGE BASE

--------------------------------------------------

Looks similar to Notion.

Collections:

Products

Manuals

FAQs

Datasheets

Warranty

Installation

Policies

Pricing

Upload PDF

Website Sync

Chunk Viewer

Embedding Status

Index Status

Version History

--------------------------------------------------

MODULE 7

PRODUCT CATALOG

--------------------------------------------------

Professional admin.

Each product includes:

Image

Category

Description

Technical Specifications

Battery Compatibility

Runtime Calculator

Accessories

Downloads

Manual PDF

Stock Status

AI Recommendation Weight

--------------------------------------------------

MODULE 8

LEAD MANAGEMENT

--------------------------------------------------

CRM table.

Columns:

Lead Score

Status

Priority

Source

Name

Company

Phone

Email

Interested Product

Assigned To

Last Activity

Next Follow-up

--------------------------------------------------

MODULE 9

PIPELINE

--------------------------------------------------

Kanban

New Lead

Qualified

Proposal

Negotiation

Won

Lost

Drag & Drop

--------------------------------------------------

MODULE 10

ANALYTICS

--------------------------------------------------

Executive dashboard.

Charts

Conversation Trend

AI Performance

Lead Conversion

Sales Performance

Most Asked Questions

Top Products

Channel Performance

Knowledge Performance

Agent Performance

Customer Satisfaction

--------------------------------------------------

MODULE 11

AUTOMATION

--------------------------------------------------

Visual workflow builder.

Examples

New Lead

↓

AI Qualification

↓

CRM

↓

Notify Sales

↓

Email

↓

Reminder

↓

Follow-up

--------------------------------------------------

MODULE 12

CHANNELS

--------------------------------------------------

Connection Manager

Website

WhatsApp

Instagram

Facebook

Email

API

Webhook

Show connection health.

--------------------------------------------------

MODULE 13

HUMAN HANDOFF

--------------------------------------------------

Queue

Waiting

Assigned

Working

Resolved

Buttons

Take Over

Transfer

Resolve

Reopen

--------------------------------------------------

MODULE 14

SETTINGS

--------------------------------------------------

Company

Branding

Knowledge Base

AI Models

OpenAI

Email

WhatsApp

Roles

Permissions

Security

Notifications

Audit Logs

--------------------------------------------------

CUSTOMER CHAT WIDGET

--------------------------------------------------

Modern floating widget.

Inspired by FloGPT.

Features

Welcome Message

Suggested Questions

Typing Animation

Images

Videos

PDF

Product Cards

Carousel

Quick Replies

Appointment Booking

Lead Capture

File Upload

Language Switch

Human Handoff

Conversation History

Theme Support

--------------------------------------------------

UX RULES

--------------------------------------------------

Every page should have

Search

Filter

Sorting

Pagination

Bulk Actions

Loading States

Empty States

Error States

Confirmation Dialogs

Toast Notifications

Skeleton Loaders

Responsive Layout

Keyboard Shortcuts

Accessibility

--------------------------------------------------

DESIGN SYSTEM

--------------------------------------------------

12px rounded corners

8px spacing system

Consistent typography

Soft shadows

Professional tables

Enterprise forms

Charts

Cards

Dialogs

Drawers

Reusable components

--------------------------------------------------

FINAL GOAL

The application should not look like a template.

It should look like a premium enterprise AI platform that could compete with Intercom, HubSpot, Zendesk, and FloGPT.

Focus on exceptional UX, consistency, scalability, and production-ready quality.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://enertechsupport.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/dc7a8ada-f571-4013-986b-91ec5c239d14).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
