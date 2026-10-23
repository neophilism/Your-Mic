import type {Metadata} from 'next';
import './globals.css';
export const metadata:Metadata={title:'Your Mic — Pick your beat. Take the mic.',description:'The album is playing. Your verse is next. Listen, choose a track, and join the live freestyle queue.',icons:{icon:'/favicon.svg'},appleWebApp:{capable:true,title:'Your Mic'},formatDetection:{telephone:false}};
export const viewport={width:'device-width',initialScale:1,viewportFit:'cover',themeColor:'#111411'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>;}
